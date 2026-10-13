/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import type { Booking } from '../types'
import { createApiClient } from './apiClient'
import { createApiDataSource } from './apiDataSource'

/**
 * End-to-end booking workflow through the real API data source, against a running
 * backend with the `dev` profile (seeded users, password `dev`). Skipped unless
 * E2E_BASE_URL is set, e.g. the Vite dev server in API mode:
 *
 *   E2E_BASE_URL=http://localhost:5173 npx vitest run apiWorkflow
 */
const BASE_URL = process.env.E2E_BASE_URL
const PASSWORD = process.env.E2E_PASSWORD ?? 'dev'

const ROOM_A = '30000000-0000-0000-0000-00000000000a' // Org A: DIRECT
const STORSALEN = '30000000-0000-0000-0000-00000000000c' // everyone: REQUEST
const ORG_A = '10000000-0000-0000-0000-00000000000a'

/** One browser: its own cookie jar, so each user has a separate session. */
function browser() {
  const jar = new Map<string, string>()
  const client = createApiClient({
    readCookie: (name) => jar.get(name),
    fetch: async (input, init = {}) => {
      const headers = new Headers(init.headers)
      if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
      const res = await fetch(new URL(String(input), BASE_URL), { ...init, headers, redirect: 'manual' })
      for (const line of res.headers.getSetCookie()) {
        const [pair, ...attrs] = line.split(';')
        const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]
        if (!value || attrs.some((a) => a.trim().toLowerCase() === 'max-age=0')) jar.delete(name)
        else jar.set(name, value)
      }
      return res
    },
  })
  return createApiDataSource(client)
}

describe.skipIf(!BASE_URL)('API booking workflow (e2e)', () => {
  // A random day ~4 months ahead keeps repeated runs from colliding.
  const day = new Date()
  day.setUTCDate(day.getUTCDate() + 100 + Math.floor(Math.random() * 60))
  const at = (hour: number) => {
    const d = new Date(day)
    d.setUTCHours(hour, Math.floor(Math.random() * 4) * 15, 0, 0)
    return d.toISOString()
  }
  const range = { start: new Date(day.getTime() - 86_400_000).toISOString(), end: new Date(day.getTime() + 2 * 86_400_000).toISOString() }
  const plusHour = (iso: string) => new Date(Date.parse(iso) + 3_600_000).toISOString()

  it('books, requests, approves, rejects and cancels with real sessions and CSRF', async () => {
    const kari = browser()
    const ola = browser()
    const admin = browser()

    expect(await kari.getSessionUserId()).toBeNull()
    await expect(kari.load(range)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(kari.auth!.login('kari@example.no', 'feil')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })

    await kari.auth!.login('kari@example.no', PASSWORD)
    await ola.auth!.login('ola@example.no', PASSWORD)
    await admin.auth!.login('admin@example.no', PASSWORD)
    expect(await kari.getSessionUserId()).toBe('20000000-0000-0000-0000-000000000001')

    // Direct booking is confirmed; a second one in the same slot is refused by the server.
    const directStart = at(8)
    const direct = await kari.createBooking({ roomId: ROOM_A, organizationId: ORG_A, title: 'E2E direkte', start: directStart, end: plusHour(directStart) })
    expect(direct.status).toBe('APPROVED')
    await expect(
      kari.createBooking({ roomId: ROOM_A, organizationId: ORG_A, title: 'E2E dobbel', start: directStart, end: plusHour(directStart) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    // Requests need approval.
    const reqStart = at(14)
    const toApprove = await kari.createBooking({ roomId: STORSALEN, organizationId: ORG_A, title: 'E2E søknad 1', start: reqStart, end: plusHour(reqStart) })
    const toReject = await kari.createBooking({ roomId: STORSALEN, organizationId: ORG_A, title: 'E2E søknad 2', start: at(18), end: plusHour(at(18)) })
    expect(toApprove.status).toBe('PENDING')

    // Other organizations see the confirmed booking, without who made it, and not the requests.
    const olaView = await ola.load(range)
    const seenByOla = olaView.bookings.find((b) => b.id === direct.id)!
    expect(seenByOla.requestedByName).toBeUndefined()
    expect(olaView.bookings.some((b) => b.id === toApprove.id)).toBe(false)

    // The admin sees the queue, approves one and rejects the other.
    const adminView = await admin.load(range)
    expect(adminView.users.length).toBeGreaterThanOrEqual(5)
    const queued = (id: string) => adminView.bookings.find((b) => b.id === id) as Booking
    expect(queued(toApprove.id).requestedByName).toBe('Kari Nordmann')
    expect((await admin.approveBooking(queued(toApprove.id))).status).toBe('APPROVED')
    await expect(admin.approveBooking(queued(toApprove.id))).rejects.toMatchObject({ code: 'INVALID_STATE' })
    expect((await admin.rejectBooking(queued(toReject.id), 'Salen er opptatt')).status).toBe('REJECTED')

    // Ordinary users can't decide requests.
    await expect(kari.approveBooking(toReject)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Kari sees the outcomes, then cancels her direct booking.
    const kariView = await kari.load(range)
    const mine = (id: string) => kariView.bookings.find((b) => b.id === id) as Booking
    expect(mine(toApprove.id)).toMatchObject({ status: 'APPROVED', decidedByName: 'Silje Aas' })
    expect(mine(toReject.id)).toMatchObject({ status: 'REJECTED', decisionComment: 'Salen er opptatt' })
    expect((await kari.cancelBooking(mine(direct.id))).status).toBe('CANCELLED')
    await expect(kari.cancelBooking(mine(direct.id))).rejects.toMatchObject({ code: 'INVALID_STATE' })

    await kari.auth!.logout()
    expect(await kari.getSessionUserId()).toBeNull()
  })
})
