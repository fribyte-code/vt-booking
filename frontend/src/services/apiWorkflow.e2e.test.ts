/// <reference types="node" />
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Booking } from '../types'
import { type ApiClient, createApiClient } from './apiClient'
import { createApiDataSource } from './apiDataSource'

/**
 * End-to-end booking workflow through the real API data source, against a running local backend
 * (`make dev`, or `make up` with E2E_BASE_URL=http://localhost:8088). Skipped unless
 * E2E_BASE_URL is set:
 *
 *   E2E_BASE_URL=http://localhost:5173 E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npx vitest run apiWorkflow
 *
 * It never touches the database directly. It logs in as an existing SYSTEM_ADMIN of the local
 * development database (created once with `make bootstrap-admin`), creates its own organizations,
 * rooms, access and users through the admin API, with random names, and afterwards disables the
 * users, archives the rooms and organizations, and cancels their future bookings. Nothing can be
 * deleted through the API, so the archived rows stay in the development database
 * (`make reset-db` empties it).
 *
 * It refuses to run against anything but a local development API: the base URL must be a loopback
 * address, and the API must be running the `dev` profile (its session cookie is not `Secure`;
 * every other configuration sets `Secure`).
 */
const BASE_URL = process.env.E2E_BASE_URL
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

const run = randomUUID().slice(0, 8)
const email = (name: string) => `${name}-${run}@e2e.invalid`
/** What the test users choose when they replace their temporary password. Random per run. */
const PASSWORD = `e2e-${randomUUID()}`

/** One browser: its own cookie jar, so each user has a separate session. */
function browser() {
  const jar = new Map<string, string>()
  // Whether each cookie was last set with the Secure attribute.
  const secure = new Map<string, boolean>()
  const api = createApiClient({
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
        secure.set(name, attrs.some((a) => a.trim().toLowerCase() === 'secure'))
      }
      return res
    },
  })
  /** True or false once the server has set a session cookie, undefined before. */
  const sessionCookieSecure = () => secure.get('JSESSIONID')
  return { api, source: createApiDataSource(api), sessionCookieSecure }
}

/** Refuses anything but a local API with the `dev` profile, before anything is written. */
function requireLocalDevelopmentApi() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to a SYSTEM_ADMIN of the local development database ' +
        '(create one with `make bootstrap-admin`).',
    )
  }
  const host = new URL(BASE_URL!).hostname
  if (!LOOPBACK.has(host)) {
    throw new Error(`E2E_BASE_URL must be a local address (localhost, 127.0.0.1 or [::1]), not ${host}.`)
  }
}

interface Fixtures {
  orgA: string
  orgB: string
  roomA: string // Org A and B: DIRECT
  storsalen: string // Org A and B: REQUEST
  users: { id: string; email: string; temporaryPassword: string }[]
}

const roomFields = (name: string, color: string) => ({
  name,
  description: null,
  location: null,
  capacity: null,
  color,
  defaultPermission: 'NONE',
})

/** Fills in `f` as each fixture is created, so a failure halfway still leaves the created ones to retire. */
async function createFixtures(api: ApiClient, f: Partial<Fixtures>) {
  const org = (name: string) => api.post<{ id: string }>('/api/admin/organizations', { name }).then((o) => o.id)
  const room = (name: string, color: string) =>
    api.post<{ id: string }>('/api/admin/rooms', roomFields(name, color)).then((r) => r.id)
  f.orgA = await org(`E2E ${run} A`)
  f.orgB = await org(`E2E ${run} B`)
  f.roomA = await room(`E2E ${run} Møterom`, '#2563eb')
  f.storsalen = await room(`E2E ${run} Sal`, '#7c3aed')
  for (const [roomId, orgId, permission] of [
    [f.roomA, f.orgA, 'DIRECT'], [f.roomA, f.orgB, 'DIRECT'], [f.storsalen, f.orgA, 'REQUEST'], [f.storsalen, f.orgB, 'REQUEST'],
  ]) {
    await api.put(`/api/admin/rooms/${roomId}/access/${orgId}`, { permission })
  }
  const user = async (name: string, displayName: string, organizationId: string) => {
    const created = await api.post<{ user: { id: string }; temporaryPassword: string }>('/api/admin/users', {
      email: email(name),
      displayName,
      globalRole: 'USER',
      memberships: [{ organizationId, role: 'MEMBER' }],
    })
    return { id: created.user.id, email: email(name), temporaryPassword: created.temporaryPassword }
  }
  f.users = []
  f.users.push(await user('kari', 'Kari Nordmann', f.orgA))
  f.users.push(await user('ola', 'Ola Hansen', f.orgB))
}

/** Disables, archives and cancels everything the run created. Best effort: every step is tried. */
async function retireFixtures(api: ApiClient, f: Partial<Fixtures>) {
  const steps = [
    ...(f.users ?? []).map((u) => () => api.patch(`/api/admin/users/${u.id}`, { status: 'DISABLED', cancelFutureBookings: true })),
    ...[
      [f.roomA, `E2E ${run} Møterom`, '#2563eb'],
      [f.storsalen, `E2E ${run} Sal`, '#7c3aed'],
    ]
      .filter(([id]) => id)
      .map(([id, name, color]) => () =>
        api.put(`/api/admin/rooms/${id}`, { ...roomFields(name!, color!), status: 'ARCHIVED', cancelFutureBookings: true }),
      ),
    ...[f.orgA, f.orgB]
      .filter((id) => id)
      .map((id) => () => api.patch(`/api/admin/organizations/${id}`, { status: 'ARCHIVED', cancelFutureBookings: true })),
  ]
  const failures: unknown[] = []
  for (const step of steps) await step().catch((err: unknown) => failures.push(err))
  if (failures.length) throw new AggregateError(failures, 'Some E2E fixtures could not be retired.')
}

describe.skipIf(!BASE_URL)('API booking workflow (e2e)', () => {
  const admin = browser()
  let adminId = ''
  const fixtures: Partial<Fixtures> = {}

  beforeAll(async () => {
    requireLocalDevelopmentApi()
    await admin.source.auth!.login(ADMIN_EMAIL!, ADMIN_PASSWORD!)
    const secure = admin.sessionCookieSecure()
    if (secure !== false) {
      await admin.source.auth!.logout()
      throw new Error(
        secure
          ? 'The API sets a Secure session cookie, so it is not running the dev profile. Refusing to write to it.'
          : 'The login set no session cookie, so the API profile is unknown. Refusing to write to it.',
      )
    }
    adminId = (await admin.source.getSessionUserId())!
    expect(admin.source.auth!.passwordChangeRequired()).toBe(false)
    await createFixtures(admin.api, fixtures)
  })

  afterAll(async () => {
    if (adminId) await retireFixtures(admin.api, fixtures)
  })

  // A day ~4 months ahead, within the 180-day booking horizon.
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
    const { orgA: ORG_A, roomA: ROOM_A, storsalen: STORSALEN, users } = fixtures as Fixtures
    const [kariUser, olaUser] = users
    const kari = browser().source
    const ola = browser().source

    expect(await kari.getSessionUserId()).toBeNull()
    await expect(kari.load(range)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(kari.auth!.login(kariUser.email, 'feil-passord-123')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })

    // New users log in with the temporary password, and must replace it before anything else.
    for (const [source, user] of [[kari, kariUser], [ola, olaUser]] as const) {
      await source.auth!.login(user.email, user.temporaryPassword)
      expect(await source.getSessionUserId()).toBe(user.id)
      expect(source.auth!.passwordChangeRequired()).toBe(true)
      await expect(source.load(range)).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
      await source.auth!.changePassword(user.temporaryPassword, PASSWORD)
    }
    expect(await kari.getSessionUserId()).toBe(kariUser.id)

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
    const adminView = await admin.source.load(range)
    // Only the admin's own user is loaded; other people's names come with the bookings.
    expect(adminView.users.map((u) => u.id)).toEqual([adminId])
    expect(adminView.users[0].role).toBe('ADMIN')
    const adminName = adminView.users[0].name
    const queued = (id: string) => adminView.bookings.find((b) => b.id === id) as Booking
    expect(queued(toApprove.id).requestedByName).toBe('Kari Nordmann')
    expect((await admin.source.approveBooking(queued(toApprove.id))).status).toBe('APPROVED')
    await expect(admin.source.approveBooking(queued(toApprove.id))).rejects.toMatchObject({ code: 'INVALID_STATE' })
    expect((await admin.source.rejectBooking(queued(toReject.id), 'Salen er opptatt')).status).toBe('REJECTED')

    // Ordinary users can't decide requests.
    await expect(kari.approveBooking(toReject)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Kari sees the outcomes, then cancels her direct booking.
    const kariView = await kari.load(range)
    const mine = (id: string) => kariView.bookings.find((b) => b.id === id) as Booking
    expect(mine(toApprove.id)).toMatchObject({ status: 'APPROVED', decidedByName: adminName })
    expect(mine(toReject.id)).toMatchObject({ status: 'REJECTED', decisionComment: 'Salen er opptatt' })
    expect((await kari.cancelBooking(mine(direct.id))).status).toBe('CANCELLED')
    await expect(kari.cancelBooking(mine(direct.id))).rejects.toMatchObject({ code: 'INVALID_STATE' })

    await kari.auth!.logout()
    expect(await kari.getSessionUserId()).toBeNull()
  })
})
