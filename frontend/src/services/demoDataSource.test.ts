import { describe, expect, it, vi } from 'vitest'
import type { KeyValueStore } from './bookingService'
import { createDemoDataSource } from './demoDataSource'

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const range = { start: '2000-01-01T00:00:00Z', end: '2100-01-01T00:00:00Z' }

describe('demo data source', () => {
  it('runs the full workflow as simulated users, without any network access', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const store = memoryStore()
    const source = createDemoDataSource(store)

    expect(await source.getSessionUserId()).toBe('user-kari')
    expect(source.auth).toBeUndefined()

    const start = new Date(Date.now() + 3 * 86_400_000)
    start.setHours(6, 0, 0, 0)
    const request = await source.createBooking({
      roomId: 'room-c',
      organizationId: 'org-a',
      title: 'Allmøte',
      start: start.toISOString(),
      end: new Date(start.getTime() + 3_600_000).toISOString(),
    })
    expect(request.status).toBe('PENDING')

    source.demo!.switchUser('user-admin')
    const approved = await source.approveBooking(request)
    expect(approved.status).toBe('APPROVED')

    source.demo!.switchUser('user-kari')
    await source.markDecisionsSeen()
    const mine = (await source.load(range)).bookings.find((b) => b.id === request.id)!
    expect(mine.decisionSeen).toBe(true)
    await expect(source.cancelBooking(mine)).resolves.toMatchObject({ status: 'CANCELLED' })

    // The chosen user survives a reload, like the old user switcher preference.
    expect(await createDemoDataSource(store).getSessionUserId()).toBe('user-kari')
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('requires a reason when rejecting, like the API', async () => {
    const source = createDemoDataSource(memoryStore())
    source.demo!.switchUser('user-admin')
    const pending = (await source.load(range)).bookings.find((b) => b.status === 'PENDING')!
    await expect(source.rejectBooking(pending, '  ')).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('edits bookings and manages series as the simulated user, without API-only capabilities', async () => {
    const source = createDemoDataSource(memoryStore())
    expect(source.invitations).toBeUndefined()

    const start = new Date(Date.now() + 2 * 86_400_000)
    start.setHours(6, 0, 0, 0)
    const at = (weeks: number, hours = 0) => new Date(start.getTime() + weeks * 7 * 86_400_000 + hours * 3_600_000)
    const until = at(2)
    const input = {
      roomId: 'room-a',
      organizationId: 'org-a',
      title: 'Øving',
      start: start.toISOString(),
      end: at(0, 1).toISOString(),
      recurrence: {
        intervalWeeks: 1,
        until: `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`,
      },
    }
    expect(await source.series.preview(input)).toHaveLength(3)
    const { seriesId, created } = await source.series.create(input)

    const moved = await source.updateBooking(created[0], {
      roomId: 'room-a',
      title: 'Flyttet',
      start: at(0, 1).toISOString(),
      end: at(0, 2).toISOString(),
    })
    expect(moved).toMatchObject({ title: 'Flyttet', status: 'APPROVED', seriesId })

    const cancelled = await source.series.cancel(seriesId, { from: created[1], reason: 'Ferie' })
    expect(cancelled.map((b) => b.id)).toEqual([created[1].id, created[2].id])
    expect((await source.series.list(seriesId)).map((b) => b.status)).toEqual(['APPROVED', 'CANCELLED', 'CANCELLED'])
  })

  it("hides other organizations' requests, like the API", async () => {
    const source = createDemoDataSource(memoryStore())
    const { bookings, users } = await source.load({ start: '', end: '' })
    const me = users.find((u) => u.id === 'user-kari')!
    expect(bookings.some((b) => b.status !== 'APPROVED' && !me.organizationIds.includes(b.organizationId))).toBe(false)
  })
})
