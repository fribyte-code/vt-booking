import { describe, expect, it } from 'vitest'
import { combineEnd } from '../lib/dates'
import type { AppData, Booking, Room, User } from '../types'
import { canChangeBooking, evaluateBooking, evaluateEdit, isExpiredRequest, matchesRequestFilter, roomsOnBehalf } from './bookingRules'

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

  it('limits duration to 12 hours and booking to 180 days ahead', () => {
    expect(evaluateBooking(data(), user, input(1, 13), NOW)).toMatchObject({ ok: true })
    expect(evaluateBooking(data(), user, input(1, 13.5), NOW)).toMatchObject({ ok: false, code: 'RULE_VIOLATION' })
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
