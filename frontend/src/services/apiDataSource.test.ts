import { describe, expect, it } from 'vitest'
import { createApiClient } from './apiClient'
import { createApiDataSource } from './apiDataSource'
import { BookingError } from './bookingError'

interface Call {
  method: string
  path: string
  headers: Record<string, string>
  body?: string
}

const ME = {
  id: 'u-kari',
  email: 'kari@example.no',
  displayName: 'Kari Nordmann',
  globalRole: 'USER',
  memberships: [{ organizationId: 'org-a', organizationName: 'Organisasjon A', role: 'MEMBER' }],
}

const BOOKING = {
  id: 'b1',
  roomId: 'room-a',
  organizationId: 'org-a',
  organizationName: 'Organisasjon A',
  requestedById: 'u-kari',
  requestedByName: 'Kari Nordmann',
  title: 'Styremøte',
  description: null,
  start: '2030-01-01T10:00:00Z',
  end: '2030-01-01T11:00:00Z',
  status: 'PENDING',
  requiresApproval: true,
  createdAt: '2029-12-01T10:00:00Z',
  decidedAt: null,
  decidedByName: null,
  decisionComment: null,
  cancelledAt: null,
  version: 3,
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fake backend: answers by path, and sets the CSRF cookie like Spring Security. */
function fakeServer(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = []
  let cookie: string | undefined
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input)
    const call: Call = {
      method: init.method ?? 'GET',
      path,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string | undefined,
    }
    calls.push(call)
    if (path === '/api/auth/csrf') {
      cookie = `token-${calls.length}`
      return new Response(null, { status: 204 })
    }
    const route = routes[`${call.method} ${path.split('?')[0]}`]
    return route ? route(call) : json(404, { code: 'NOT_FOUND', detail: 'Ukjent.' })
  }) as typeof globalThis.fetch
  const client = createApiClient({ fetch, readCookie: () => cookie })
  return { calls, client, clearCookie: () => (cookie = undefined) }
}

describe('API data source', () => {
  it('reports a missing session as null instead of an error', async () => {
    const { client } = fakeServer({ 'GET /api/me': () => new Response(null, { status: 401 }) })
    await expect(createApiDataSource(client).getSessionUserId()).resolves.toBeNull()
  })

  it('maps API responses onto the shared types and limits the calendar range to 62 days', async () => {
    const { client, calls } = fakeServer({
      'GET /api/me': () => json(200, ME),
      'GET /api/rooms': () =>
        json(200, [
          {
            id: 'room-a',
            name: 'Møterom A',
            description: null,
            location: '2. etasje',
            capacity: 8,
            color: '#2563eb',
            status: 'ACTIVE',
            permissions: [{ organizationId: 'org-a', permission: 'DIRECT' }],
          },
        ]),
      'GET /api/organizations': () => json(200, [{ id: 'org-a', name: 'Organisasjon A' }]),
      'GET /api/bookings': () => json(200, [BOOKING]),
      'GET /api/bookings/mine': () => json(200, [BOOKING]),
    })

    const data = await createApiDataSource(client).load({
      start: '2030-01-01T00:00:00.000Z',
      end: '2030-06-01T00:00:00.000Z',
    })

    expect(data.users).toEqual([
      { id: 'u-kari', name: 'Kari Nordmann', email: 'kari@example.no', role: 'USER', organizationIds: ['org-a'] },
    ])
    expect(data.rooms[0].permissions).toEqual({ 'org-a': 'DIRECT' })
    expect(data.rooms[0].description).toBe('')
    expect(data.bookings).toHaveLength(1) // de-duplicated across calendar and "mine"
    expect(data.bookings[0]).toMatchObject({ id: 'b1', version: 3, requestedByName: 'Kari Nordmann', decisionSeen: false })
    expect(data.bookings[0].description).toBeUndefined()

    const calendar = calls.find((c) => c.path.startsWith('/api/bookings?'))!
    const query = new URLSearchParams(calendar.path.split('?')[1])
    expect(Date.parse(query.get('to')!) - Date.parse(query.get('from')!)).toBe(62 * 24 * 60 * 60 * 1000)
    // Admin-only endpoints are not requested for ordinary users.
    expect(calls.some((c) => c.path.startsWith('/api/admin') || c.path === '/api/bookings/requests')).toBe(false)
  })

  it('sends the CSRF token and the booking version with decisions', async () => {
    const { client, calls } = fakeServer({
      'POST /api/bookings/b1/reject': () => json(200, { ...BOOKING, status: 'REJECTED', version: 4 }),
    })
    const source = createApiDataSource(client)

    const result = await source.rejectBooking({ ...BOOKING, version: 3 } as never, 'Opptatt')

    const post = calls.find((c) => c.method === 'POST')!
    expect(calls[0].path).toBe('/api/auth/csrf') // no cookie yet, so it is fetched first
    expect(post.headers['X-XSRF-TOKEN']).toBe('token-1')
    expect(JSON.parse(post.body!)).toEqual({ version: 3, reason: 'Opptatt' })
    expect(result.status).toBe('REJECTED')
  })

  it('turns Problem Details into BookingError with the server message', async () => {
    const { client } = fakeServer({
      'POST /api/bookings': () =>
        json(409, { status: 409, code: 'CONFLICT', detail: 'Møterom A er allerede booket i dette tidsrommet.' }),
    })
    const promise = createApiDataSource(client).createBooking({
      roomId: 'room-a',
      organizationId: 'org-a',
      title: 'Test',
      start: BOOKING.start,
      end: BOOKING.end,
    })
    await expect(promise).rejects.toBeInstanceOf(BookingError)
    await expect(promise).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Møterom A er allerede booket i dette tidsrommet.',
    })
  })

  it('retries once with a fresh token when the CSRF token is refused', async () => {
    let attempts = 0
    const { client, calls } = fakeServer({
      'POST /api/bookings/b1/cancel': () =>
        ++attempts === 1 ? new Response(null, { status: 403 }) : json(200, { ...BOOKING, status: 'CANCELLED' }),
    })
    await createApiDataSource(client).cancelBooking(BOOKING as never)
    expect(attempts).toBe(2)
    expect(calls.filter((c) => c.path === '/api/auth/csrf')).toHaveLength(2)
  })

  it('reports wrong credentials, and a network failure, with a readable message', async () => {
    const { client } = fakeServer({ 'POST /api/auth/login': () => new Response(null, { status: 401 }) })
    await expect(createApiDataSource(client).auth!.login('kari@example.no', 'feil')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Feil e-post eller passord.',
    })

    const offline = createApiClient({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      readCookie: () => undefined,
    })
    await expect(createApiDataSource(offline).load({ start: BOOKING.start, end: BOOKING.end })).rejects.toMatchObject({
      code: 'NETWORK',
    })
  })

  it('has no demo capabilities', () => {
    const { client } = fakeServer({})
    expect(createApiDataSource(client).demo).toBeUndefined()
  })
})
