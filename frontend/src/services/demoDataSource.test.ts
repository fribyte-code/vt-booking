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
})
