/**
 * Domain types. These mirror the planned PostgreSQL tables
 * (users, organizations, memberships, rooms, room_access, bookings)
 * and the JSON the future Spring Boot API is expected to return.
 * All timestamps are ISO 8601 strings.
 */

export type Permission = 'DIRECT' | 'REQUEST' | 'NONE'

export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export type UserRole = 'USER' | 'ADMIN'

export interface Organization {
  id: string
  name: string
  description: string
}

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  /** Memberships. In the database this is the `memberships` join table. */
  organizationIds: string[]
}

export interface Room {
  id: string
  name: string
  description: string
  location: string
  capacity: number
  /** Hex color used in the calendar. */
  color: string
  /** Booking permission per organization id (the `room_access` table). Missing entries mean NONE. */
  permissions: Record<string, Permission>
}

export interface Booking {
  id: string
  roomId: string
  organizationId: string
  requestedById: string
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
  decisionComment?: string
  /** Whether the requester has seen the admin's decision (drives notifications). */
  decisionSeen?: boolean
  cancelledAt?: string
  cancelledById?: string
}

export interface CreateBookingInput {
  roomId: string
  organizationId: string
  title: string
  description?: string
  start: string
  end: string
}

export interface DemoData {
  users: User[]
  organizations: Organization[]
  rooms: Room[]
  bookings: Booking[]
}
