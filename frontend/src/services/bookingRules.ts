import type { AppData, Booking, BookingStatus, CreateBookingInput, OpeningHoursEntry, Permission, Room, TimeSlot, UpdateBookingInput, User, Weekday } from '../types'

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

/**
 * The longest a booking, request or public request can last (backend `BookingLimits`): 07:00 to
 * 05:00 the next day, all the closed hours leave.
 */
export const MAX_DURATION_HOURS = 22
/** Same limit as the backend's BookingService. */
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

export const WEEKDAYS: Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
export const weekdayShort: Record<Weekday, string> = {
  MONDAY: 'man',
  TUESDAY: 'tir',
  WEDNESDAY: 'ons',
  THURSDAY: 'tor',
  FRIDAY: 'fre',
  SATURDAY: 'lør',
  SUNDAY: 'søn',
}

export const weekdayNames: Record<Weekday, string> = {
  MONDAY: 'Mandag',
  TUESDAY: 'Tirsdag',
  WEDNESDAY: 'Onsdag',
  THURSDAY: 'Torsdag',
  FRIDAY: 'Fredag',
  SATURDAY: 'Lørdag',
  SUNDAY: 'Søndag',
}

/** "HH:MM", with 24:00 for midnight as a closing time. */
export const OPENING_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/

/** Why opening hours can't be saved, or null. The backend's `OpeningHours.parse` checks the same. */
export function openingHoursProblem(hours: OpeningHoursEntry[]): string | null {
  for (const h of hours) {
    if (!OPENING_TIME.test(h.opens) || !OPENING_TIME.test(h.closes)) {
      return `${weekdayNames[h.day]}: skriv tidene som TT:MM, for eksempel 16:30.`
    }
    if (h.opens === '24:00' || h.closes <= h.opens) return `${weekdayNames[h.day]}: åpningstiden må starte før den slutter.`
  }
  return null
}

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Whether [start, end) lies within the room's opening hours: inside the interval of the day it
 * starts on (Europe/Oslo), ending at 24:00 at the latest. No hours means always open. Same as
 * the backend's `OpeningHours.allows`.
 */
export function withinOpeningHours(hours: OpeningHoursEntry[] | undefined, start: string, end: string): boolean {
  if (!hours || hours.length === 0) return true
  const s = wallClock(Date.parse(start))
  const e = wallClock(Date.parse(end))
  const day = Math.floor(s / DAY) * DAY
  // getUTCDay: 0 = Sunday.
  const weekday = WEEKDAYS[(new Date(day).getUTCDay() + 6) % 7]
  const open = hours.find((h) => h.day === weekday)
  if (!open) return false
  return toMinutes(open.opens) <= (s - day) / 60_000 && (e - day) / 60_000 <= toMinutes(open.closes)
}

/** E.g. "man–fre 16:30–24:00, lør–søn 08:00–16:00", like the backend's `OpeningHours.describe`. */
export function describeOpeningHours(hours: OpeningHoursEntry[]): string {
  const sorted = [...hours].sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day))
  const parts: string[] = []
  for (let i = 0; i < sorted.length; ) {
    const first = sorted[i]
    let j = i
    while (
      j + 1 < sorted.length &&
      WEEKDAYS.indexOf(sorted[j + 1].day) === WEEKDAYS.indexOf(sorted[j].day) + 1 &&
      sorted[j + 1].opens === first.opens &&
      sorted[j + 1].closes === first.closes
    ) {
      j++
    }
    const days = weekdayShort[first.day] + (j > i ? `–${weekdayShort[sorted[j].day]}` : '')
    parts.push(`${days} ${first.opens}–${first.closes}`)
    i = j + 1
  }
  return parts.join(', ')
}

/** The backend's message when a booking is outside a room's opening hours. */
export function openingHoursMessage(roomName: string, hours: OpeningHoursEntry[]): string {
  return `${roomName} er bare åpent ${describeOpeningHours(hours)}.`
}

function checkOpeningHours(room: Room, slot: TimeSlot): Failure | null {
  if (withinOpeningHours(room.openingHours, slot.start, slot.end)) return null
  return { ok: false, code: 'RULE_VIOLATION', message: openingHoursMessage(room.name, room.openingHours ?? []) }
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
  const closed = checkOpeningHours(room, input)
  if (closed) return closed

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
    return { ok: false, code: 'RULE_VIOLATION', message: `En booking kan vare i høyst ${MAX_DURATION_HOURS} timer.` }
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
  const closed = checkOpeningHours(room, input)
  if (closed) return closed
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

/**
 * Who may approve and reject requests in the booking's room: system admins, and the ORG_ADMINs of
 * the organization managing the room (`managedRoomIds`). The backend's `Viewer.mayDecide`.
 */
export function canDecide(user: User, booking: Pick<Booking, 'roomId'>): boolean {
  return user.role === 'ADMIN' || (user.managedRoomIds ?? []).includes(booking.roomId)
}

/**
 * The approval queue among the loaded bookings, for what the user may decide: pending requests
 * that have not expired, by start, and decided requests, latest first.
 */
export function approvalQueue(
  bookings: Booking[],
  user: User,
  now: number = Date.now(),
): { pending: Booking[]; processed: Booking[] } {
  const mine = bookings.filter((b) => canDecide(user, b))
  return {
    pending: mine.filter((b) => b.status === 'PENDING' && !isExpiredRequest(b, now)).sort((a, b) => a.start.localeCompare(b.start)),
    processed: mine
      .filter((b) => b.requiresApproval && b.decidedAt)
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')),
  }
}

/** The "Forvaltes av" value for rooms managed by VT (system admins only). */
export const VT_MANAGER = 'vt'

/** Who manages the room's requests: an organization id, or `VT_MANAGER`. Unknown (archived) rooms count as VT. */
export function roomManager(rooms: Room[], roomId: string): string {
  return rooms.find((r) => r.id === roomId)?.managingOrganizationId ?? VT_MANAGER
}

/** Which requests to list. An empty list doesn't limit that category. */
export interface RequestFilter {
  organizationIds: string[]
  roomIds: string[]
  /** Organization ids or `VT_MANAGER`: who manages the request's room. */
  managerIds?: string[]
}

export const NO_REQUEST_FILTER: RequestFilter = { organizationIds: [], roomIds: [], managerIds: [] }

export const hasRequestFilter = (f: RequestFilter) => f.organizationIds.length + f.roomIds.length + (f.managerIds?.length ?? 0) > 0

/**
 * Any of the chosen organizations AND any of the chosen rooms AND any of the chosen managers
 * (`managerOf` gives a room's, see `roomManager`).
 */
export function matchesRequestFilter(
  b: Pick<Booking, 'organizationId' | 'roomId'>,
  f: RequestFilter,
  managerOf: (roomId: string) => string = () => VT_MANAGER,
): boolean {
  return (
    (f.organizationIds.length === 0 || f.organizationIds.includes(b.organizationId)) &&
    (f.roomIds.length === 0 || f.roomIds.includes(b.roomId)) &&
    (!f.managerIds?.length || f.managerIds.includes(managerOf(b.roomId)))
  )
}
