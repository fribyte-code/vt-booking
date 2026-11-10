import type { AppData, Booking, BookingStatus, CreateBookingInput, Permission, Room, TimeSlot, UpdateBookingInput, User } from '../types'

/**
 * Pure booking rules, shared by the service layer (enforcement) and the UI
 * (live feedback in forms). In production these rules live in the backend;
 * the frontend copy is only for user feedback.
 */

export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_MEMBER'
  | 'NO_PERMISSION'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_STATE'
  | 'VERSION_CONFLICT'
  | 'RULE_VIOLATION'
  | 'UNAUTHENTICATED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'NETWORK'

export type RuleResult =
  | { ok: true; permission: Exclude<Permission, 'NONE'> }
  | { ok: false; code: ErrorCode; message: string; conflicts?: Booking[] }

/** Same limits as the backend's BookingService. */
export const MAX_DURATION_HOURS = 12
export const MAX_ADVANCE_DAYS = 180
/** No room can be used between these local hours (backend `ClosedHours`, time zone `booking.time-zone`). */
export const CLOSED_FROM_HOUR = 5
export const CLOSED_TO_HOUR = 7
export const CLOSED_HOURS_MESSAGE =
  'Rommene kan ikke brukes mellom kl. 05:00 og 07:00. Velg et tidspunkt som slutter senest 05:00 eller starter tidligst 07:00.'
const BOOKING_TIME_ZONE = 'Europe/Oslo'

type Failure = Extract<RuleResult, { ok: false }>

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const osloParts = new Intl.DateTimeFormat('en-US', {
  timeZone: BOOKING_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

/** The wall-clock time in the booking time zone, as milliseconds on a UTC scale. */
function wallClock(ms: number): number {
  const p = Object.fromEntries(osloParts.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) + (ms % 1000)
}

/**
 * Whether [start, end) overlaps 05:00–07:00 local time on any day. Ending at 05:00 or starting at
 * 07:00 is fine. Same as the backend's `ClosedHours.overlaps`, always in Europe/Oslo.
 */
export function overlapsClosedHours(start: string, end: string): boolean {
  const s = wallClock(Date.parse(start))
  const e = wallClock(Date.parse(end))
  for (let day = Math.floor(s / DAY) * DAY; day <= e; day += DAY) {
    if (s < day + CLOSED_TO_HOUR * HOUR && e > day + CLOSED_FROM_HOUR * HOUR) return true
  }
  return false
}

export const permissionLabels: Record<Permission, string> = {
  DIRECT: 'Direkte booking',
  REQUEST: 'Krever godkjenning',
  NONE: 'Ingen tilgang',
}

export function getPermission(room: Room | undefined, organizationId: string): Permission {
  return room?.permissions[organizationId] ?? 'NONE'
}

/**
 * The rooms as a system admin sees them when booking a public request on behalf of an
 * organization (the backend's `createOnBehalf`): every open room counts as DIRECT for the given
 * organizations, so the booking is approved directly. Closed rooms stay unbookable, and no access
 * is changed.
 */
export function roomsOnBehalf(rooms: Room[], organizationIds: string[]): Room[] {
  return rooms.map((r) =>
    r.status === 'DISABLED'
      ? r
      : {
          ...r,
          permissions: Object.fromEntries(
            organizationIds.map((id) => [id, 'DIRECT']),
          ),
        },
  )
}

/**
 * A pending request whose start has passed. It can no longer be approved or withdrawn, so it is
 * left out of the calendar and the admin queue, and shown as expired in "my bookings".
 */
export function isExpiredRequest(booking: Pick<Booking, 'status' | 'start'>, now: number = Date.now()): boolean {
  return booking.status === 'PENDING' && Date.parse(booking.start) <= now
}

/** Only approved bookings occupy a room. Pending, rejected and cancelled ones do not. */
export function blocksAvailability(booking: Booking): boolean {
  return booking.status === 'APPROVED'
}

export function findConflicts(
  bookings: Booking[],
  roomId: string,
  start: string,
  end: string,
  excludeId?: string,
): Booking[] {
  const s = Date.parse(start)
  const e = Date.parse(end)
  return bookings.filter(
    (b) =>
      b.id !== excludeId &&
      b.roomId === roomId &&
      blocksAvailability(b) &&
      Date.parse(b.start) < e &&
      s < Date.parse(b.end),
  )
}

export function evaluateBooking(
  data: AppData,
  user: User,
  input: CreateBookingInput,
  now: Date = new Date(),
): RuleResult {
  if (!input.title.trim()) {
    return { ok: false, code: 'VALIDATION', message: 'Gi bookingen en tittel.' }
  }
  const invalidTimes = checkTimes(input, now)
  if (invalidTimes) return invalidTimes
  if (!user.organizationIds.includes(input.organizationId)) {
    return {
      ok: false,
      code: 'NOT_MEMBER',
      message: 'Du kan bare booke på vegne av organisasjoner du er medlem av.',
    }
  }

  const room = data.rooms.find((r) => r.id === input.roomId)
  if (!room) {
    return { ok: false, code: 'NOT_FOUND', message: 'Rommet finnes ikke.' }
  }

  const access = checkAccess(data, room, input.organizationId)
  if (!access.ok) return access

  const conflicts = findConflicts(data.bookings, room.id, input.start, input.end)
  if (conflicts.length > 0) return conflictFailure(room, conflicts)

  return access
}

/** Time rules for a new or moved booking (same as the backend's `validateTimes`). */
function checkTimes(slot: TimeSlot, now: Date): Failure | null {
  const start = Date.parse(slot.start)
  const end = Date.parse(slot.end)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return { ok: false, code: 'VALIDATION', message: 'Ugyldig dato eller klokkeslett.' }
  }
  if (end <= start) {
    return { ok: false, code: 'VALIDATION', message: 'Sluttidspunktet må være etter starttidspunktet.' }
  }
  if (start < now.getTime()) {
    return { ok: false, code: 'VALIDATION', message: 'Du kan ikke booke et tidspunkt som har passert.' }
  }
  if (end - start > MAX_DURATION_HOURS * HOUR) {
    return { ok: false, code: 'RULE_VIOLATION', message: `En booking kan vare maks ${MAX_DURATION_HOURS} timer.` }
  }
  if (start > now.getTime() + MAX_ADVANCE_DAYS * 24 * HOUR) {
    return {
      ok: false,
      code: 'RULE_VIOLATION',
      message: `Du kan ikke booke mer enn ${MAX_ADVANCE_DAYS} dager frem i tid.`,
    }
  }
  if (overlapsClosedHours(slot.start, slot.end)) {
    return { ok: false, code: 'RULE_VIOLATION', message: CLOSED_HOURS_MESSAGE }
  }
  return null
}

function checkAccess(data: AppData, room: Room, organizationId: string): RuleResult {
  if (room.status === 'DISABLED') {
    return { ok: false, code: 'NO_PERMISSION', message: `${room.name} er stengt og kan ikke bookes.` }
  }
  const permission = getPermission(room, organizationId)
  if (permission === 'NONE') {
    const org = data.organizations.find((o) => o.id === organizationId)
    return {
      ok: false,
      code: 'NO_PERMISSION',
      message: `${org?.name ?? 'Organisasjonen'} har ikke tilgang til å booke ${room.name}.`,
    }
  }
  return { ok: true, permission }
}

function conflictFailure(room: Room, conflicts: Booking[]): Failure {
  return { ok: false, code: 'CONFLICT', message: `${room.name} er allerede booket i dette tidsrommet.`, conflicts }
}

// ── Editing ────────────────────────────────────────────────────

/**
 * Who may edit or cancel a booking (the backend's `mayChange`): system administrators, the
 * requester while still a member of the booking's organization, and that organization's
 * administrators. The backend also requires the organization to be active for organization admins.
 */
export function canChangeBooking(user: User, booking: Booking): boolean {
  if (user.role === 'ADMIN') return true
  if (!user.organizationIds.includes(booking.organizationId)) return false
  return booking.requestedById === user.id || (user.orgAdminOrganizationIds?.includes(booking.organizationId) ?? false)
}

/** Approved bookings and requests that have not started can still be edited or cancelled. */
export function isOpenForChanges(booking: Booking, now: number = Date.now()): boolean {
  return (booking.status === 'APPROVED' || booking.status === 'PENDING') && Date.parse(booking.start) > now
}

/** True when the edit gives the booking a new room or time, not just a new title or description. */
export function isMove(booking: Booking, input: Pick<UpdateBookingInput, 'roomId' | 'start' | 'end'>): boolean {
  return (
    input.roomId !== booking.roomId ||
    Date.parse(input.start) !== Date.parse(booking.start) ||
    Date.parse(input.end) !== Date.parse(booking.end)
  )
}

/**
 * The status a moved booking gets: DIRECT is approved at once; REQUEST makes it a new request
 * (the slot is free until approved), except when a system administrator moves an approved booking.
 */
export function statusAfterMove(
  permission: Exclude<Permission, 'NONE'>,
  actorIsAdmin: boolean,
  current: BookingStatus,
): 'APPROVED' | 'PENDING' {
  if (permission === 'DIRECT') return 'APPROVED'
  return actorIsAdmin && current === 'APPROVED' ? 'APPROVED' : 'PENDING'
}

export type EditResult =
  | {
      ok: true
      moved: boolean
      status: 'APPROVED' | 'PENDING'
      permission?: Exclude<Permission, 'NONE'>
      /** An approved booking becomes a request again and loses its slot until approved. */
      losesApproval: boolean
    }
  | Failure

const ARCHIVED_ROOM_MESSAGE = 'Rommet er arkivert. Bookingen kan bare få ny tittel eller beskrivelse, eller kanselleres.'

/** Checks an edit like the backend's `BookingService.update`, and tells what status the booking gets. */
export function evaluateEdit(
  data: AppData,
  user: User,
  booking: Booking,
  input: UpdateBookingInput,
  now: Date = new Date(),
): EditResult {
  if (!canChangeBooking(user, booking)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Du har ikke lov til å endre denne bookingen.' }
  }
  if (booking.status !== 'APPROVED' && booking.status !== 'PENDING') {
    return { ok: false, code: 'INVALID_STATE', message: 'Bookingen er avsluttet og kan ikke endres.' }
  }
  if (Date.parse(booking.start) <= now.getTime()) {
    return { ok: false, code: 'INVALID_STATE', message: 'Bookinger og søknader som har startet, kan ikke endres.' }
  }
  if (!input.title.trim()) {
    return { ok: false, code: 'VALIDATION', message: 'Gi bookingen en tittel.' }
  }
  if (!isMove(booking, input)) {
    return { ok: true, moved: false, status: booking.status, losesApproval: false }
  }

  // Archived rooms are not in the room list, so a booking whose room is missing can't be moved.
  if (!data.rooms.some((r) => r.id === booking.roomId)) {
    return { ok: false, code: 'INVALID_STATE', message: ARCHIVED_ROOM_MESSAGE }
  }
  const invalidTimes = checkTimes(input, now)
  if (invalidTimes) return invalidTimes
  const room = data.rooms.find((r) => r.id === input.roomId)
  if (!room) {
    return { ok: false, code: 'NOT_FOUND', message: 'Rommet finnes ikke.' }
  }
  const access = checkAccess(data, room, booking.organizationId)
  if (!access.ok) return access

  const conflicts = findConflicts(data.bookings, room.id, input.start, input.end, booking.id)
  if (conflicts.length > 0) return conflictFailure(room, conflicts)

  const status = statusAfterMove(access.permission, user.role === 'ADMIN', booking.status)
  return {
    ok: true,
    moved: true,
    status,
    permission: access.permission,
    losesApproval: booking.status === 'APPROVED' && status === 'PENDING',
  }
}

/** Which requests to list. An empty list doesn't limit that category. */
export interface RequestFilter {
  organizationIds: string[]
  roomIds: string[]
}

export const NO_REQUEST_FILTER: RequestFilter = { organizationIds: [], roomIds: [] }

export const hasRequestFilter = (f: RequestFilter) => f.organizationIds.length + f.roomIds.length > 0

/** Any of the chosen organizations AND any of the chosen rooms. */
export function matchesRequestFilter(b: Pick<Booking, 'organizationId' | 'roomId'>, f: RequestFilter): boolean {
  return (
    (f.organizationIds.length === 0 || f.organizationIds.includes(b.organizationId)) &&
    (f.roomIds.length === 0 || f.roomIds.includes(b.roomId))
  )
}
