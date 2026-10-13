/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Booking } from '../types'
import { createApiClient } from './apiClient'
import { createApiDataSource } from './apiDataSource'

/**
 * End-to-end booking workflow through the real API data source, against a running backend
 * (`make dev`, or `make up` with E2E_BASE_URL=http://localhost:8088). Skipped unless
 * E2E_BASE_URL is set:
 *
 *   E2E_BASE_URL=http://localhost:5173 npx vitest run apiWorkflow
 *
 * The application has no seed data and no admin API yet, so the test creates its own users,
 * organizations, rooms and permissions directly in the local development database (through
 * `docker compose exec db psql`, override with E2E_PSQL), with random IDs, and deletes them
 * and their bookings afterwards. Leftovers from an interrupted run are removed first.
 */
const BASE_URL = process.env.E2E_BASE_URL
const PSQL = process.env.E2E_PSQL?.split(' ') ?? [
  'docker', 'compose', '-f', fileURLToPath(new URL('../../../compose.yaml', import.meta.url)),
  'exec', '-T', 'db', 'psql', '-U', 'booking', '-d', 'booking',
]

/** Argon2id hash of PASSWORD, as the backend's PasswordEncoder produces it. */
const PASSWORD = 'fixture-passord-2026'
const PASSWORD_HASH = '{argon2}$argon2id$v=19$m=19456,t=2,p=1$kwxC5odEhb0S4E0rPMCihg$+scAhIZvhg0XDkHNdDU9Q/an9FKQq/sUEqTO4eWTN0s'
const DOMAIN = 'e2e.invalid'

const run = randomUUID().slice(0, 8)
const ids = {
  kari: randomUUID(), ola: randomUUID(), admin: randomUUID(),
  orgA: randomUUID(), orgB: randomUUID(),
  roomA: randomUUID(), storsalen: randomUUID(),
}
const email = (name: string) => `${name}-${run}@${DOMAIN}`

function psql(sql: string) {
  execFileSync(PSQL[0], [...PSQL.slice(1), '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe', 'ignore', 'inherit'] })
}

/** Deletes every E2E fixture (this run's and any earlier interrupted run's) and their bookings. */
const CLEANUP = `
  DELETE FROM bookings WHERE requested_by_id IN (SELECT id FROM users WHERE email LIKE '%@${DOMAIN}')
    OR decided_by_id IN (SELECT id FROM users WHERE email LIKE '%@${DOMAIN}')
    OR cancelled_by_id IN (SELECT id FROM users WHERE email LIKE '%@${DOMAIN}')
    OR room_id IN (SELECT id FROM rooms WHERE name LIKE 'E2E %')
    OR organization_id IN (SELECT id FROM organizations WHERE name LIKE 'E2E %');
  DELETE FROM rooms WHERE name LIKE 'E2E %';
  DELETE FROM users WHERE email LIKE '%@${DOMAIN}';
  DELETE FROM organizations WHERE name LIKE 'E2E %';
`

const FIXTURES = `
  INSERT INTO organizations (id, name) VALUES ('${ids.orgA}', 'E2E ${run} A'), ('${ids.orgB}', 'E2E ${run} B');
  INSERT INTO users (id, email, display_name, global_role, status, password_hash, password_changed_at) VALUES
    ('${ids.kari}', '${email('kari')}', 'Kari Nordmann', 'USER', 'ACTIVE', '${PASSWORD_HASH}', now()),
    ('${ids.ola}', '${email('ola')}', 'Ola Hansen', 'USER', 'ACTIVE', '${PASSWORD_HASH}', now()),
    ('${ids.admin}', '${email('admin')}', 'Silje Aas', 'SYSTEM_ADMIN', 'ACTIVE', '${PASSWORD_HASH}', now());
  INSERT INTO memberships (user_id, organization_id) VALUES ('${ids.kari}', '${ids.orgA}'), ('${ids.ola}', '${ids.orgB}');
  INSERT INTO rooms (id, name, color) VALUES ('${ids.roomA}', 'E2E ${run} Møterom', '#2563eb'), ('${ids.storsalen}', 'E2E ${run} Sal', '#7c3aed');
  INSERT INTO room_access (room_id, organization_id, permission) VALUES
    ('${ids.roomA}', '${ids.orgA}', 'DIRECT'), ('${ids.roomA}', '${ids.orgB}', 'DIRECT'),
    ('${ids.storsalen}', '${ids.orgA}', 'REQUEST'), ('${ids.storsalen}', '${ids.orgB}', 'REQUEST');
`

const ROOM_A = ids.roomA // Org A and B: DIRECT
const STORSALEN = ids.storsalen // everyone: REQUEST
const ORG_A = ids.orgA

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
  beforeAll(() => psql(CLEANUP + FIXTURES))
  afterAll(() => psql(CLEANUP))

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
    const kari = browser()
    const ola = browser()
    const admin = browser()

    expect(await kari.getSessionUserId()).toBeNull()
    await expect(kari.load(range)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(kari.auth!.login(email('kari'), 'feil-passord-123')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })

    await kari.auth!.login(email('kari'), PASSWORD)
    await ola.auth!.login(email('ola'), PASSWORD)
    await admin.auth!.login(email('admin'), PASSWORD)
    expect(await kari.getSessionUserId()).toBe(ids.kari)

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
    expect(adminView.users.map((u) => u.id)).toEqual(expect.arrayContaining([ids.kari, ids.ola, ids.admin]))
    expect(adminView.users.find((u) => u.id === ids.admin)?.role).toBe('ADMIN')
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
