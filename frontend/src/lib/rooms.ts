import type { Booking, Room } from '../types'

/** Calendar color for bookings in rooms that are no longer listed (archived). */
export const NEUTRAL_ROOM_COLOR = '#94a3b8'

export interface RoomInfo {
  /** Undefined when the room is archived or unknown: it is not in the room list. */
  room?: Room
  name: string
  color: string
}

/**
 * The booking's room for display. Archived rooms are left out of the room list but may still
 * have bookings, so fall back to the name the API sends with the booking and a neutral color.
 */
export function roomInfo(room: Room | undefined, booking: Pick<Booking, 'roomName'>): RoomInfo {
  return {
    room,
    name: room?.name ?? booking.roomName ?? 'Arkivert rom',
    color: room?.color ?? NEUTRAL_ROOM_COLOR,
  }
}
