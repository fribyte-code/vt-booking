import { describe, expect, it, vi } from 'vitest'
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
  mustChangePassword: false,
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
function fakeServer(custom: Record<string, (call: Call) => Response>) {
  const routes: Record<string, (call: Call) => Response> = { 'GET /api/me/invitations': () => json(200, []), ...custom }
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
      {
        id: 'u-kari',
        name: 'Kari Nordmann',
        email: 'kari@example.no',
        role: 'USER',
        organizationIds: ['org-a'],
        orgAdminOrganizationIds: [],
      },
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

  it('treats SYSTEM_ADMIN as an administrator and loads the request queues, but not the user list', async () => {
    const admin = { ...ME, id: 'u-admin', globalRole: 'SYSTEM_ADMIN', memberships: [] }
    const { client, calls } = fakeServer({
      'GET /api/me': () => json(200, admin),
      'GET /api/rooms': () => json(200, []),
      'GET /api/organizations': () => json(200, []),
      'GET /api/bookings': () => json(200, []),
      'GET /api/bookings/mine': () => json(200, []),
      'GET /api/bookings/requests': () => json(200, []),
      'GET /api/admin/public-requests': () => json(200, [{ status: 'NEW' }, { status: 'TRANSFERRED' }, { status: 'NEW' }]),
    })

    const data = await createApiDataSource(client).load({ start: '2030-01-01T00:00:00.000Z', end: '2030-01-08T00:00:00.000Z' })

    expect(data.users).toEqual([expect.objectContaining({ id: 'u-admin', role: 'ADMIN' })])
    expect(calls.some((c) => c.path === '/api/bookings/requests')).toBe(true)
    // Only the unhandled public requests are counted.
    expect(data.newPublicRequests).toBe(2)
    // Names of other people come with the bookings; the management pages load users themselves.
    expect(calls.some((c) => c.path === '/api/admin/users')).toBe(false)
  })

  it('reuses the session check for the first load, and asks again on later loads', async () => {
    const { client, calls } = fakeServer({
      'GET /api/me': () => json(200, ME),
      'GET /api/rooms': () => json(200, []),
      'GET /api/organizations': () => json(200, []),
      'GET /api/bookings': () => json(200, []),
      'GET /api/bookings/mine': () => json(200, []),
      'GET /api/me/invitations': () => json(200, []),
    })
    const source = createApiDataSource(client)
    const range = { start: '2030-01-01T00:00:00.000Z', end: '2030-01-08T00:00:00.000Z' }
    const meCalls = () => calls.filter((c) => c.path === '/api/me').length

    expect(await source.getSessionUserId()).toBe(ME.id)
    await source.load(range)
    expect(meCalls()).toBe(1)
    // A reload (after a change, or an accepted invitation) must see new memberships and roles.
    await source.load(range)
    expect(meCalls()).toBe(2)
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

  it('sends approval comments and cancellation reasons, and omits blank ones', async () => {
    const { client, calls } = fakeServer({
      'POST /api/bookings/b1/approve': () => json(200, { ...BOOKING, status: 'APPROVED' }),
      'POST /api/bookings/b1/cancel': () => json(200, { ...BOOKING, status: 'CANCELLED' }),
    })
    const source = createApiDataSource(client)
    await source.approveBooking({ ...BOOKING, version: 3 } as never, ' Velkommen ')
    await source.cancelBooking({ ...BOOKING, version: 4 } as never, '  ')

    const posts = calls.filter((c) => c.method === 'POST' && c.path.startsWith('/api/bookings'))
    expect(JSON.parse(posts[0].body!)).toEqual({ version: 3, comment: 'Velkommen' })
    expect(JSON.parse(posts[1].body!)).toEqual({ version: 4 })
  })

  it('loads one room\'s bookings for an availability check', async () => {
    const { client, calls } = fakeServer({ 'GET /api/bookings': () => json(200, [BOOKING]) })
    const found = await createApiDataSource(client).listBookings(
      { start: '2030-01-01T00:00:00.000Z', end: '2030-01-02T00:00:00.000Z' },
      'room-a',
    )
    expect(found.map((b) => b.id)).toEqual(['b1'])
    const query = new URLSearchParams(calls[0].path.split('?')[1])
    expect(query.get('roomId')).toBe('room-a')
    expect(query.get('from')).toBe('2030-01-01T00:00:00.000Z')
  })

  it('treats a cancellation by someone else as news for the requester', async () => {
    const cancelled = {
      ...BOOKING,
      status: 'CANCELLED',
      cancelledAt: '2030-01-01T10:00:00.000Z',
      cancelledById: 'u-admin',
      cancelledByName: 'Silje Aas',
      cancellationReason: 'Brannøvelse',
    }
    const { client } = fakeServer({
      'GET /api/me': () => json(200, ME),
      'GET /api/rooms': () => json(200, []),
      'GET /api/organizations': () => json(200, []),
      'GET /api/bookings': () => json(200, []),
      'GET /api/bookings/mine': () => json(200, [cancelled]),
    })
    const data = await createApiDataSource(client).load({ start: BOOKING.start, end: BOOKING.end })
    expect(data.bookings.find((b) => b.id === 'b1')).toMatchObject({
      decisionSeen: false,
      cancelledByName: 'Silje Aas',
      cancellationReason: 'Brannøvelse',
    })
  })

  it('maps edit, series and archived-room fields, and loads the user\'s invitations', async () => {
    const edited = {
      ...BOOKING,
      roomId: 'room-archived',
      roomName: 'Gamle møterom',
      updatedAt: '2029-12-02T10:00:00Z',
      updatedByName: 'Kari Nordmann',
      seriesId: 's1',
    }
    const invitation = {
      id: 'inv1',
      organizationId: 'org-b',
      organizationName: 'Organisasjon B',
      role: 'MEMBER',
      invitedByName: 'Ola Hansen',
      createdAt: '2029-12-01T10:00:00Z',
    }
    const { client } = fakeServer({
      'GET /api/me': () => json(200, ME),
      'GET /api/rooms': () => json(200, []),
      'GET /api/organizations': () => json(200, []),
      'GET /api/bookings': () => json(200, []),
      'GET /api/bookings/mine': () => json(200, [edited]),
      'GET /api/me/invitations': () => json(200, [invitation]),
    })
    const data = await createApiDataSource(client).load({ start: BOOKING.start, end: BOOKING.end })
    expect(data.bookings[0]).toMatchObject({
      roomName: 'Gamle møterom',
      updatedAt: '2029-12-02T10:00:00Z',
      updatedByName: 'Kari Nordmann',
      seriesId: 's1',
    })
    expect(data.invitations).toEqual([invitation])
    // Not in the directory of active organizations: known from the booking, and marked archived.
    expect(data.organizations).toEqual([
      { id: BOOKING.organizationId, name: BOOKING.organizationName, description: '', archived: true },
    ])
  })

  it('edits a booking with its version and no identity fields', async () => {
    const { client, calls } = fakeServer({
      'PUT /api/bookings/b1': () => json(200, { ...BOOKING, title: 'Nytt navn', version: 4 }),
    })
    const updated = await createApiDataSource(client).updateBooking({ ...BOOKING, version: 3 } as never, {
      roomId: 'room-a',
      title: 'Nytt navn',
      description: '  ',
      start: BOOKING.start,
      end: BOOKING.end,
    })
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.headers['X-XSRF-TOKEN']).toBeDefined()
    expect(JSON.parse(put.body!)).toEqual({ version: 3, roomId: 'room-a', title: 'Nytt navn', start: BOOKING.start, end: BOOKING.end })
    expect(updated).toMatchObject({ title: 'Nytt navn', version: 4 })
  })

  it('creates a series, and reports taken dates from a 409 as conflicts', async () => {
    const conflicts = [{ start: '2030-01-08T10:00:00Z', end: '2030-01-08T11:00:00Z' }]
    let attempt = 0
    const { client, calls } = fakeServer({
      'POST /api/bookings/series': () =>
        ++attempt === 1
          ? json(409, { code: 'CONFLICT', detail: '1 av 3 tidspunkter i serien er opptatt i Møterom A.', conflicts })
          : json(201, { seriesId: 's1', created: [{ ...BOOKING, seriesId: 's1' }], skipped: conflicts }),
    })
    const source = createApiDataSource(client)
    const input = {
      roomId: 'room-a',
      organizationId: 'org-a',
      title: 'Øving',
      start: BOOKING.start,
      end: BOOKING.end,
      recurrence: { intervalWeeks: 1, until: '2030-01-15' },
    }

    await expect(source.series.create(input)).rejects.toMatchObject({ code: 'CONFLICT', conflicts })
    const created = await source.series.create({ ...input, skipConflicts: true })

    const posts = calls.filter((c) => c.path === '/api/bookings/series')
    expect(JSON.parse(posts[0].body!)).toEqual(input)
    expect(JSON.parse(posts[1].body!)).toMatchObject({ skipConflicts: true })
    expect(created).toMatchObject({ seriesId: 's1', skipped: conflicts })
    expect(created.created[0].seriesId).toBe('s1')
  })

  it('previews a series without the skip flag', async () => {
    const { client, calls } = fakeServer({
      'POST /api/bookings/series/preview': () =>
        json(200, { occurrences: [{ start: BOOKING.start, end: BOOKING.end, conflict: true }] }),
    })
    const occurrences = await createApiDataSource(client).series.preview({
      roomId: 'room-a',
      organizationId: 'org-a',
      title: '-',
      start: BOOKING.start,
      end: BOOKING.end,
      recurrence: { intervalWeeks: 2, until: '2030-02-01' },
      skipConflicts: true,
    })
    expect(occurrences).toEqual([{ start: BOOKING.start, end: BOOKING.end, conflict: true }])
    expect(JSON.parse(calls.find((c) => c.method === 'POST' && c.path.endsWith('preview'))!.body!).skipConflicts).toBeUndefined()
  })

  it('edits, cancels and decides series by occurrence', async () => {
    const occurrence = { ...BOOKING, id: 'b2', seriesId: 's1', version: 5 }
    const { client, calls } = fakeServer({
      'PUT /api/bookings/series/s1': () =>
        json(200, { updated: [occurrence], skipped: [{ id: 'b3', start: BOOKING.start, end: BOOKING.end }] }),
      'POST /api/bookings/series/s1/cancel': () => json(200, [{ ...occurrence, status: 'CANCELLED' }]),
      'POST /api/bookings/series/s1/approve': () =>
        json(200, {
          approved: [{ ...occurrence, status: 'APPROVED' }],
          notApproved: [{ id: 'b3', start: BOOKING.start, end: BOOKING.end, code: 'CONFLICT', reason: 'Opptatt.' }],
        }),
      'POST /api/bookings/series/s1/reject': () => json(200, [{ ...occurrence, status: 'REJECTED' }]),
      'GET /api/bookings/series/s1': () => json(200, [occurrence]),
    })
    const source = createApiDataSource(client)
    const input = { roomId: 'room-a', title: 'Øving', start: BOOKING.start, end: BOOKING.end }

    const dry = await source.series.update(occurrence as never, input, { dryRun: true, skipConflicts: true })
    expect(dry.skipped).toEqual([{ id: 'b3', start: BOOKING.start, end: BOOKING.end }])
    await source.series.cancel('s1', { from: occurrence as never, reason: 'Ferie' })
    await source.series.cancel('s1', {})
    const approved = await source.series.approve('s1', ' ')
    await source.series.reject('s1', 'Nei')
    expect((await source.series.list('s1')).map((b) => b.id)).toEqual(['b2'])

    const bodies = calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/api/bookings')).map((c) => JSON.parse(c.body!))
    expect(bodies[0]).toEqual({ fromBookingId: 'b2', version: 5, ...input, skipConflicts: true, dryRun: true })
    expect(bodies[1]).toEqual({ fromBookingId: 'b2', reason: 'Ferie' })
    expect(bodies[2]).toEqual({})
    expect(bodies[3]).toEqual({})
    expect(bodies[4]).toEqual({ reason: 'Nei' })
    expect(approved.notApproved[0]).toMatchObject({ id: 'b3', code: 'CONFLICT' })
  })

  it('accepts and declines invitations', async () => {
    const { client, calls } = fakeServer({
      'POST /api/me/invitations/inv1/accept': () => json(200, ME),
      'POST /api/me/invitations/inv2/decline': () => new Response(null, { status: 204 }),
    })
    const source = createApiDataSource(client)
    await source.invitations!.accept('inv1')
    await source.invitations!.decline('inv2')
    const posts = calls.filter((c) => c.method === 'POST' && c.path.startsWith('/api/me'))
    expect(posts.map((c) => c.path)).toEqual(['/api/me/invitations/inv1/accept', '/api/me/invitations/inv2/decline'])
    expect(posts.every((c) => c.headers['X-XSRF-TOKEN'])).toBe(true)
  })

  it('marks news as seen up to the newest one shown, and hides old news on a new device', async () => {
    const memory = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
    })
    try {
      const decided = (id: string, end: string, decidedAt: string) => ({
        ...BOOKING, id, status: 'APPROVED', end, start: BOOKING.start, decidedAt, decidedByName: 'Silje Aas',
      })
      const past = decided('old', '2020-01-01T11:00:00Z', '2019-12-01T10:00:00.5Z')
      const future = decided('new', '2099-01-01T11:00:00Z', '2030-01-01T09:00:00Z')
      const later = decided('later', '2099-01-02T11:00:00Z', '2030-01-02T09:00:00Z')
      let mine = [past, future]
      const { client } = fakeServer({
        'GET /api/me': () => json(200, ME),
        'GET /api/rooms': () => json(200, []),
        'GET /api/organizations': () => json(200, []),
        'GET /api/bookings': () => json(200, []),
        'GET /api/bookings/mine': () => json(200, mine),
        'GET /api/me/invitations': () => json(200, []),
      })
      const source = createApiDataSource(client)
      const range = { start: BOOKING.start, end: BOOKING.end }

      // First login in this browser: news about bookings that already ended is not shown again.
      const first = await source.load(range)
      expect(first.bookings.find((b) => b.id === 'old')?.decisionSeen).toBe(true)
      expect(first.bookings.find((b) => b.id === 'new')?.decisionSeen).toBe(false)

      // Marking as read covers what was loaded, not a decision made after the load.
      await source.markDecisionsSeen()
      mine = [past, future, later]
      const second = await source.load(range)
      expect(second.bookings.find((b) => b.id === 'new')?.decisionSeen).toBe(true)
      expect(second.bookings.find((b) => b.id === 'later')?.decisionSeen).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('forgets that a password change was required once the session is gone', async () => {
    let me: () => Response = () => json(200, { ...ME, mustChangePassword: true })
    const { client } = fakeServer({
      'GET /api/me': () => me(),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    })
    const source = createApiDataSource(client)

    await source.getSessionUserId()
    expect(source.auth.passwordChangeRequired()).toBe(true)
    await source.auth.logout()
    expect(source.auth.passwordChangeRequired()).toBe(false)

    await source.getSessionUserId()
    expect(source.auth.passwordChangeRequired()).toBe(true)
    me = () => json(401, {})
    await source.getSessionUserId()
    expect(source.auth.passwordChangeRequired()).toBe(false)
  })
})
