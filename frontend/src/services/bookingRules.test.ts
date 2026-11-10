import { describe, expect, it } from 'vitest'
import { combineEnd } from '../lib/dates'
import type { AppData, Booking, OpeningHoursEntry, Room, User } from '../types'
import {
  approvalQueue,
  canChangeBooking,
  canDecide,
  describeOpeningHours,
  evaluateBooking,
  evaluateEdit,
  isExpiredRequest,
  matchesRequestFilter,
  openingHoursProblem,
  roomManager,
  VT_MANAGER,
  overlapsClosedHours,
  roomsOnBehalf,
  withinOpeningHours,
} from './bookingRules'

const NOW = new Date('2030-01-01T10:00:00Z')
const HOUR = 3_600_000
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString()

const user: User = { id: 'u', name: 'Kari', email: 'k@example.no', role: 'USER', organizationIds: ['org'] }
const room: Room = { id: 'r', name: 'Møterom', description: '', location: '', color: '#000000', permissions: { org: 'DIRECT' } }
const data = (rooms = [room], bookings: Booking[] = []): AppData => ({ users: [user], organizations: [], rooms, bookings })
const input = (start: number, end: number) => ({ roomId: 'r', organizationId: 'org', title: 'Møte', start: at(start), end: at(end) })

describe('bookingRules', () => {
  it('lets an admin book a public request for an organization without access, but not in a closed room', () => {
    const admin: User = { ...user, role: 'ADMIN', organizationIds: [] }
    const noAccess = input(1, 2)
    const other = { ...noAccess, organizationId: 'other' }
    // The normal rules refuse it.
    expect(evaluateBooking(data(), { ...admin, organizationIds: ['other'] }, other, NOW)).toMatchObject({ code: 'NO_PERMISSION' })

    const onBehalf = roomsOnBehalf(
      [room, { ...room, id: 'closed', status: 'DISABLED' }, { ...room, id: 'apply', permissions: { org: 'REQUEST' } }],
      ['org', 'other'],
    )
    expect(onBehalf[0].permissions).toEqual({ org: 'DIRECT', other: 'DIRECT' })
    // Even where the organization must apply, the admin's booking is approved directly.
    expect(onBehalf[2].permissions).toEqual({ org: 'DIRECT', other: 'DIRECT' })
    expect(evaluateBooking(data(onBehalf), { ...admin, organizationIds: ['other'] }, other, NOW)).toMatchObject({ ok: true, permission: 'DIRECT' })
    expect(evaluateBooking(data(onBehalf), { ...admin, organizationIds: ['other'] }, { ...other, roomId: 'closed' }, NOW)).toMatchObject({
      code: 'NO_PERMISSION',
    })
    // The original rooms are unchanged.
    expect(room.permissions).toEqual({ org: 'DIRECT' })
  })

  it('treats a pending request as expired once it has started', () => {
    const request = { status: 'PENDING' as const, start: at(1) }
    expect(isExpiredRequest(request, NOW.getTime())).toBe(false)
    expect(isExpiredRequest(request, NOW.getTime() + HOUR)).toBe(true)
    expect(isExpiredRequest({ status: 'APPROVED', start: at(-1) }, NOW.getTime())).toBe(false)
  })

  it('limits duration to 22 hours and booking to 180 days ahead', () => {
    // NOW is 11:00 in Oslo: +20 h is 07:00 the next day, +42 h 05:00 the day after.
    expect(evaluateBooking(data(), user, input(20, 42), NOW)).toMatchObject({ ok: true })
    expect(evaluateBooking(data(), user, input(20, 42.25), NOW)).toMatchObject({
      ok: false,
      code: 'RULE_VIOLATION',
      message: 'En booking kan vare i høyst 22 timer.',
    })
    expect(evaluateBooking(data(), user, input(181 * 24, 181 * 24 + 1), NOW)).toMatchObject({
      ok: false,
      code: 'RULE_VIOLATION',
    })
  })

  it('allows a booking past midnight and finds conflicts on the next day', () => {
    const local = (s: string) => new Date(s).toISOString()
    const overnight = {
      ...input(0, 0),
      start: local('2030-01-05T22:00'),
      end: combineEnd('2030-01-05', '22:00', '02:00'),
    }
    expect(evaluateBooking(data(), user, overnight, NOW)).toMatchObject({ ok: true })

    const nextMorning: Booking = {
      id: 'b',
      roomId: 'r',
      organizationId: 'org',
      requestedById: 'u',
      title: 'Frokost',
      start: local('2030-01-06T01:00'),
      end: local('2030-01-06T03:00'),
      status: 'APPROVED',
      requiresApproval: false,
      createdAt: at(-1),
    }
    expect(evaluateBooking(data([room], [nextMorning]), user, overnight, NOW)).toMatchObject({ ok: false, code: 'CONFLICT' })

    const tooLong = { ...overnight, start: local('2030-01-05T20:00'), end: combineEnd('2030-01-05', '20:00', '09:00') }
    expect(evaluateBooking(data(), user, tooLong, NOW)).toMatchObject({ ok: false, code: 'RULE_VIOLATION' })
  })

  it('refuses disabled rooms', () => {
    const closed = { ...room, status: 'DISABLED' as const }
    expect(evaluateBooking(data([closed]), user, input(1, 2), NOW)).toMatchObject({
      ok: false,
      message: 'Møterom er stengt og kan ikke bookes.',
    })
  })

  describe('editing', () => {
    const admin: User = { ...user, id: 'admin', role: 'ADMIN', organizationIds: [] }
    const requestRoom: Room = { ...room, id: 'r2', name: 'Storsal', permissions: { org: 'REQUEST' } }
    const booking = (patch: Partial<Booking> = {}): Booking => ({
      id: 'b',
      roomId: 'r',
      organizationId: 'org',
      requestedById: 'u',
      title: 'Møte',
      start: at(2),
      end: at(3),
      status: 'APPROVED',
      requiresApproval: false,
      createdAt: at(-1),
      ...patch,
    })
    const edit = (b: Booking, patch: Partial<{ roomId: string; start: string; end: string; title: string }> = {}) => ({
      roomId: b.roomId,
      title: b.title,
      start: b.start,
      end: b.end,
      ...patch,
    })

    it('lets the requester, organization administrators and system administrators change a booking', () => {
      const other: User = { ...user, id: 'other' }
      expect(canChangeBooking(user, booking())).toBe(true)
      expect(canChangeBooking(other, booking())).toBe(false)
      expect(canChangeBooking({ ...other, orgAdminOrganizationIds: ['org'] }, booking())).toBe(true)
      expect(canChangeBooking(admin, booking())).toBe(true)
      // A requester who left the organization can no longer change it.
      expect(canChangeBooking({ ...user, organizationIds: [] }, booking())).toBe(false)
    })

    it('keeps the status for a new title, and ignores the booking itself when checking conflicts', () => {
      const b = booking()
      expect(evaluateEdit(data([room], [b]), user, b, edit(b, { title: 'Nytt' }), NOW)).toMatchObject({
        ok: true,
        moved: false,
        status: 'APPROVED',
      })
      expect(evaluateEdit(data([room], [b]), user, b, edit(b, { end: at(4) }), NOW)).toMatchObject({ ok: true, moved: true })
      const other = booking({ id: 'o', start: at(3), end: at(4) })
      expect(evaluateEdit(data([room], [b, other]), user, b, edit(b, { end: at(4) }), NOW)).toMatchObject({ code: 'CONFLICT' })
    })

    it('turns an approved booking moved into a request room into a new request, except for system administrators', () => {
      const b = booking()
      const moved = edit(b, { roomId: 'r2' })
      expect(evaluateEdit(data([room, requestRoom], [b]), user, b, moved, NOW)).toMatchObject({
        ok: true,
        status: 'PENDING',
        losesApproval: true,
      })
      expect(evaluateEdit(data([room, requestRoom], [b]), admin, b, moved, NOW)).toMatchObject({
        ok: true,
        status: 'APPROVED',
        losesApproval: false,
      })
    })

    it('refuses moving bookings in archived rooms, and bookings that have started or ended', () => {
      const archived = booking({ roomId: 'gone' })
      expect(evaluateEdit(data(), user, archived, edit(archived, { title: 'Nytt' }), NOW)).toMatchObject({ ok: true })
      expect(evaluateEdit(data(), user, archived, edit(archived, { start: at(5), end: at(6) }), NOW)).toMatchObject({
        code: 'INVALID_STATE',
      })
      const started = booking({ start: at(-1) })
      expect(evaluateEdit(data(), user, started, edit(started), NOW)).toMatchObject({ code: 'INVALID_STATE' })
      const cancelled = booking({ status: 'CANCELLED' })
      expect(evaluateEdit(data(), user, cancelled, edit(cancelled), NOW)).toMatchObject({ code: 'INVALID_STATE' })
    })
  })
})

describe('matchesRequestFilter', () => {
  const requests = [
    { organizationId: 'A', roomId: '101' },
    { organizationId: 'A', roomId: '103' },
    { organizationId: 'B', roomId: '102' },
    { organizationId: 'C', roomId: '101' },
  ]
  const ids = (organizationIds: string[], roomIds: string[]) =>
    requests.filter((r) => matchesRequestFilter(r, { organizationIds, roomIds })).map((r) => `${r.organizationId}${r.roomId}`)

  it('shows everything without a filter', () => {
    expect(ids([], [])).toHaveLength(4)
  })

  it('ORs within a category', () => {
    expect(ids(['A', 'B'], [])).toEqual(['A101', 'A103', 'B102'])
    expect(ids([], ['101', '102'])).toEqual(['A101', 'B102', 'C101'])
  })

  it('ANDs the categories', () => {
    expect(ids(['A', 'B'], ['101', '102'])).toEqual(['A101', 'B102'])
    expect(ids(['C'], ['102'])).toEqual([])
  })
})

describe('closed hours', () => {
  it('closes every room between 05:00 and 07:00 Norwegian time', () => {
    // Winter time (UTC+1).
    expect(overlapsClosedHours('2030-01-04T20:00+01:00', '2030-01-05T05:00+01:00')).toBe(false)
    expect(overlapsClosedHours('2030-01-05T07:00+01:00', '2030-01-05T12:00+01:00')).toBe(false)
    expect(overlapsClosedHours('2030-01-04T22:00+01:00', '2030-01-05T05:15+01:00')).toBe(true)
    expect(overlapsClosedHours('2030-01-05T06:45+01:00', '2030-01-05T10:00+01:00')).toBe(true)
    expect(overlapsClosedHours('2030-01-05T05:30+01:00', '2030-01-05T06:30+01:00')).toBe(true)
    // Summer time (UTC+2): 05:00 is 03:00Z.
    expect(overlapsClosedHours('2030-07-01T01:00:00Z', '2030-07-01T03:00:00Z')).toBe(false)
    expect(overlapsClosedHours('2030-07-01T01:00:00Z', '2030-07-01T03:30:00Z')).toBe(true)

    const night = { roomId: 'r', organizationId: 'org', title: 'Fest', start: '2030-01-02T01:00+01:00', end: '2030-01-02T06:00+01:00' }
    expect(evaluateBooking(data(), user, night, NOW)).toMatchObject({ ok: false, code: 'RULE_VIOLATION' })
  })
})

describe('opening hours', () => {
  // UiB-kantina: weekdays 16:30–24:00, weekends 08:00–16:00.
  const canteen: OpeningHoursEntry[] = [
    ...(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const).map((day) => ({ day, opens: '16:30', closes: '24:00' })),
    ...(['SATURDAY', 'SUNDAY'] as const).map((day) => ({ day, opens: '08:00', closes: '16:00' })),
  ]

  it('allows only bookings within the start day’s interval, up to 24:00', () => {
    // Tuesday 1 January 2030 is a Tuesday; Saturday 5 January.
    expect(withinOpeningHours(canteen, '2030-01-01T16:30+01:00', '2030-01-01T20:00+01:00')).toBe(true)
    expect(withinOpeningHours(canteen, '2030-01-01T18:00+01:00', '2030-01-02T00:00+01:00')).toBe(true)
    expect(withinOpeningHours(canteen, '2030-01-01T16:00+01:00', '2030-01-01T18:00+01:00')).toBe(false)
    expect(withinOpeningHours(canteen, '2030-01-01T20:00+01:00', '2030-01-02T01:00+01:00')).toBe(false)
    expect(withinOpeningHours(canteen, '2030-01-05T08:00+01:00', '2030-01-05T16:00+01:00')).toBe(true)
    expect(withinOpeningHours(canteen, '2030-01-05T15:00+01:00', '2030-01-05T17:00+01:00')).toBe(false)
    expect(withinOpeningHours([{ day: 'SATURDAY', opens: '08:00', closes: '16:00' }], '2030-01-01T10:00+01:00', '2030-01-01T11:00+01:00')).toBe(false)
    expect(withinOpeningHours([], '2030-01-01T01:00+01:00', '2030-01-01T04:00+01:00')).toBe(true)
  })

  it('describes the hours like the backend', () => {
    expect(describeOpeningHours(canteen)).toBe('man–fre 16:30–24:00, lør–søn 08:00–16:00')
  })

  it('refuses a booking outside the room’s hours with the backend’s message', () => {
    const tuesday = new Date('2029-12-31T10:00:00Z')
    const result = evaluateBooking(data([{ ...room, openingHours: canteen }]), user, {
      roomId: 'r',
      organizationId: 'org',
      title: 'Lunsj',
      start: '2030-01-01T12:00+01:00',
      end: '2030-01-01T13:00+01:00',
    }, tuesday)
    expect(result).toMatchObject({ ok: false, code: 'RULE_VIOLATION', message: 'Møterom er bare åpent man–fre 16:30–24:00, lør–søn 08:00–16:00.' })
  })

  it('validates hours before saving', () => {
    expect(openingHoursProblem(canteen)).toBeNull()
    expect(openingHoursProblem([{ day: 'MONDAY', opens: '18:00', closes: '16:00' }])).toMatch(/starte før/)
    expect(openingHoursProblem([{ day: 'MONDAY', opens: '8', closes: '16:00' }])).toMatch(/TT:MM/)
    expect(openingHoursProblem([{ day: 'MONDAY', opens: '08:00', closes: '24:30' }])).toMatch(/TT:MM/)
  })
})

describe('room managers', () => {
  const manager: User = { ...user, organizationIds: ['org'], managedRoomIds: ['r'] }
  const admin: User = { ...user, role: 'ADMIN', organizationIds: [] }
  const request = (id: string, roomId: string, extra: Partial<Booking> = {}) =>
    ({ id, roomId, organizationId: 'other', status: 'PENDING', start: at(24), end: at(25), requiresApproval: true, ...extra }) as Booking

  it('lets system admins and the room’s managers decide, nobody else', () => {
    expect(canDecide(manager, { roomId: 'r' })).toBe(true)
    expect(canDecide(manager, { roomId: 'other-room' })).toBe(false)
    expect(canDecide(user, { roomId: 'r' })).toBe(false)
    expect(canDecide(admin, { roomId: 'other-room' })).toBe(true)
  })

  it('queues only the requests the user may decide', () => {
    const bookings = [
      request('p1', 'r'),
      request('p2', 'other-room'),
      request('done', 'r', { status: 'APPROVED', decidedAt: at(-1) }),
      request('expired', 'r', { start: at(-48), end: at(-47) }),
    ]
    const queue = approvalQueue(bookings, manager, NOW.getTime())
    expect(queue.pending.map((b) => b.id)).toEqual(['p1'])
    expect(queue.processed.map((b) => b.id)).toEqual(['done'])
    expect(approvalQueue(bookings, admin, NOW.getTime()).pending.map((b) => b.id)).toEqual(['p1', 'p2'])
  })

  it('filters by who manages the room, VT for unmanaged rooms', () => {
    const rooms = [{ ...room, managingOrganizationId: 'samfundet' }, { ...room, id: 'vt-room' }]
    const managerOf = (roomId: string) => roomManager(rooms, roomId)
    expect(managerOf('r')).toBe('samfundet')
    expect(managerOf('vt-room')).toBe(VT_MANAGER)
    expect(managerOf('archived')).toBe(VT_MANAGER)
    const f = { organizationIds: [], roomIds: [], managerIds: [VT_MANAGER] }
    expect(matchesRequestFilter(request('a', 'vt-room'), f, managerOf)).toBe(true)
    expect(matchesRequestFilter(request('b', 'r'), f, managerOf)).toBe(false)
  })
})
