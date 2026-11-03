import type { AppData, Booking, BookingStatus, CreateBookingInput, Permission, Recurrence, Room, TimeSlot, UpdateBookingInput, User } from '../types'

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

/** Same limits as the backend's BookingService and BookingSeriesService. */
export const MAX_DURATION_HOURS = 12
export const MAX_ADVANCE_DAYS = 180
export const MIN_SERIES_OCCURRENCES = 2
export const MAX_SERIES_OCCURRENCES = 52

type Failure = Extract<RuleResult, { ok: false }>

const HOUR = 60 * 60 * 1000

export const permissionLabels: Record<Permission, string> = {
  DIRECT: 'Direkte booking',
  REQUEST: 'Krever godkjenning',
  NONE: 'Ingen tilgang',
}

export function getPermission(room: Room | undefined, organizationId: string): Permission {
  return room?.permissions[organizationId] ?? 'NONE'
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

// ── Weekly series ──────────────────────────────────────────────

/**
 * The occurrences of a weekly series in local time, so 18:00–20:00 stays 18:00–20:00 across
 * daylight saving changes (like the backend's `BookingSeriesService.occurrences`). Each must also
 * pass the single-booking time rules.
 */
export function seriesOccurrences(
  first: TimeSlot,
  recurrence: Recurrence,
  now: Date = new Date(),
): { ok: true; slots: TimeSlot[] } | Failure {
  const start = new Date(first.start)
  const end = new Date(first.end)
  const step = recurrence.intervalWeeks
  if (!Number.isInteger(step) || step < 1 || step > 4) {
    return { ok: false, code: 'VALIDATION', message: 'Velg hvor ofte bookingen skal gjentas.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recurrence.until) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, code: 'VALIDATION', message: 'Ugyldig dato eller klokkeslett.' }
  }

  const slots: TimeSlot[] = []
  for (let i = 0; ; i++) {
    const s = addLocalDays(start, i * 7 * step)
    if (localDate(s) > recurrence.until) break
    if (slots.length === MAX_SERIES_OCCURRENCES) {
      return {
        ok: false,
        code: 'RULE_VIOLATION',
        message: `En serie kan ha maks ${MAX_SERIES_OCCURRENCES} forekomster. Velg en tidligere sluttdato.`,
      }
    }
    slots.push({ start: s.toISOString(), end: addLocalDays(end, i * 7 * step).toISOString() })
  }
  if (slots.length < MIN_SERIES_OCCURRENCES) {
    return { ok: false, code: 'VALIDATION', message: 'En serie må ha minst to forekomster. Velg en senere sluttdato.' }
  }
  const last = Date.parse(slots[slots.length - 1].start)
  if (last > now.getTime() + MAX_ADVANCE_DAYS * 24 * HOUR) {
    return {
      ok: false,
      code: 'RULE_VIOLATION',
      message: `Serien går for langt frem i tid. Du kan booke maks ${MAX_ADVANCE_DAYS} dager frem.`,
    }
  }
  for (const slot of slots) {
    const invalid = checkTimes(slot, now)
    if (invalid) return invalid
  }
  return { ok: true, slots }
}

function addLocalDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

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
