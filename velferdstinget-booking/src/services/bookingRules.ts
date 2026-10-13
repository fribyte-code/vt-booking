import type { Booking, CreateBookingInput, DemoData, Permission, Room, User } from '../types'

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

export type RuleResult =
  | { ok: true; permission: Exclude<Permission, 'NONE'> }
  | { ok: false; code: ErrorCode; message: string; conflicts?: Booking[] }

export const permissionLabels: Record<Permission, string> = {
  DIRECT: 'Direkte booking',
  REQUEST: 'Krever godkjenning',
  NONE: 'Ingen tilgang',
}

export function getPermission(room: Room | undefined, organizationId: string): Permission {
  return room?.permissions[organizationId] ?? 'NONE'
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
  data: DemoData,
  user: User,
  input: CreateBookingInput,
  now: Date = new Date(),
): RuleResult {
  const start = Date.parse(input.start)
  const end = Date.parse(input.end)

  if (!input.title.trim()) {
    return { ok: false, code: 'VALIDATION', message: 'Gi bookingen en tittel.' }
  }
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return { ok: false, code: 'VALIDATION', message: 'Ugyldig dato eller klokkeslett.' }
  }
  if (end <= start) {
    return { ok: false, code: 'VALIDATION', message: 'Sluttidspunktet må være etter starttidspunktet.' }
  }
  if (start < now.getTime()) {
    return { ok: false, code: 'VALIDATION', message: 'Du kan ikke booke et tidspunkt som har passert.' }
  }
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

  const permission = getPermission(room, input.organizationId)
  if (permission === 'NONE') {
    const org = data.organizations.find((o) => o.id === input.organizationId)
    return {
      ok: false,
      code: 'NO_PERMISSION',
      message: `${org?.name ?? 'Organisasjonen'} har ikke tilgang til å booke ${room.name}.`,
    }
  }

  const conflicts = findConflicts(data.bookings, room.id, input.start, input.end)
  if (conflicts.length > 0) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: `${room.name} er allerede booket i dette tidsrommet.`,
      conflicts,
    }
  }

  return { ok: true, permission }
}
