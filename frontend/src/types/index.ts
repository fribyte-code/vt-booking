/**
 * Domain types shared by both data sources. They mirror the PostgreSQL tables
 * (users, organizations, memberships, rooms, room_access, bookings); the API
 * data source maps the Spring Boot responses onto them.
 * All timestamps are ISO 8601 strings.
 */

export type Permission = 'DIRECT' | 'REQUEST' | 'NONE'

export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export type UserRole = 'USER' | 'ADMIN'

export interface Organization {
  id: string
  name: string
  description: string
  /** Archived: only known because it owns loaded bookings. Can't be booked for. */
  archived?: boolean
}

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  /** Memberships. In the database this is the `memberships` join table. */
  organizationIds: string[]
  /** Signed-in user only: organizations this user administers (ORG_ADMIN). */
  orgAdminOrganizationIds?: string[]
}

export type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

/** One weekday's opening hours in local time, "HH:MM"; `closes` "24:00" is midnight. */
export interface OpeningHoursEntry {
  day: Weekday
  opens: string
  closes: string
}

export interface Room {
  id: string
  name: string
  description: string
  location: string
  /** Number of seats, when the administrator has set it. */
  capacity?: number
  /** A disabled room is shown but can't be booked. */
  status?: 'ACTIVE' | 'DISABLED'
  /** Hex color used in the calendar. */
  color: string
  /** Booking permission per organization id (the `room_access` table). Missing entries mean NONE. */
  permissions: Record<string, Permission>
  /** Empty or missing: open around the clock (apart from 05:00–07:00). */
  openingHours?: OpeningHoursEntry[]
}

export interface Booking {
  id: string
  roomId: string
  organizationId: string
  requestedById: string
  /** Set by the API, which only returns names the user may see. */
  requestedByName?: string
  title: string
  description?: string
  start: string
  end: string
  status: BookingStatus
  /** True when the booking was created as a request that needed admin approval. */
  requiresApproval: boolean
  createdAt: string
  decidedAt?: string
  decidedById?: string
  decidedByName?: string
  decisionComment?: string
  /**
   * Whether the requester has seen what happened to the booking: the admin's decision, or a
   * cancellation by someone else (drives notifications).
   */
  decisionSeen?: boolean
  cancelledAt?: string
  cancelledById?: string
  cancelledByName?: string
  cancellationReason?: string
  /** When the booking was last edited (title, description, room or time). */
  updatedAt?: string
  updatedById?: string
  /** Who edited it, for the own organization and administrators. */
  updatedByName?: string
  /** Shared by the occurrences of a weekly series. */
  seriesId?: string
  /**
   * The room's name, also for archived rooms, which are not in `AppData.rooms`.
   * Use it when the room can't be looked up.
   */
  roomName?: string
  /** Optimistic-locking version from the API, sent back with edit, approve, reject and cancel. */
  version?: number
}

export interface CreateBookingInput {
  roomId: string
  organizationId: string
  title: string
  description?: string
  start: string
  end: string
}

/** A new room, time, title or description for an existing booking. The organization can't change. */
export interface UpdateBookingInput {
  roomId: string
  title: string
  description?: string
  start: string
  end: string
}

export interface TimeSlot {
  start: string
  end: string
}

/** A series occurrence that was or would be skipped, with the new time it would have got. */
export interface OccurrenceSlot extends TimeSlot {
  id: string
}

/** Every `intervalWeeks` weeks (1–4), up to and including the local date `until` (`YYYY-MM-DD`). */
export interface Recurrence {
  intervalWeeks: number
  until: string
}

/** A weekly series. `start` and `end` are the first occurrence. */
export interface CreateSeriesInput extends CreateBookingInput {
  recurrence: Recurrence
  /** Create only the free occurrences instead of failing when some are taken. */
  skipConflicts?: boolean
}

export interface SeriesPreviewOccurrence extends TimeSlot {
  /** The time overlaps an approved booking. */
  conflict: boolean
}

export interface SeriesCreated {
  seriesId: string
  created: Booking[]
  skipped: TimeSlot[]
}

export interface SeriesUpdateOptions {
  /** Leave occurrences whose new time is taken unchanged instead of failing. */
  skipConflicts?: boolean
  /** Only report what would change. */
  dryRun?: boolean
}

export interface SeriesUpdated {
  updated: Booking[]
  skipped: OccurrenceSlot[]
}

export interface SeriesApproved {
  approved: Booking[]
  notApproved: (OccurrenceSlot & { code: string; reason: string })[]
}

/** An invitation to join an organization, waiting for the signed-in user's answer. */
export interface Invitation {
  id: string
  organizationId: string
  organizationName: string
  role: 'MEMBER' | 'ORG_ADMIN'
  invitedByName: string | null
  createdAt: string
}

export interface AppData {
  users: User[]
  organizations: Organization[]
  rooms: Room[]
  bookings: Booking[]
  /** The signed-in user's pending invitations. */
  invitations?: Invitation[]
  /** Admins only: unhandled (NEW) requests from the public form. */
  newPublicRequests?: number
}
