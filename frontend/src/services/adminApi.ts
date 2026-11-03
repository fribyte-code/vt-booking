import type { BookingStatus, Permission } from '../types'
import { createApiClient } from './apiClient'

/**
 * User, organization and room management against the Spring Boot API. The server enforces
 * every permission (SYSTEM_ADMIN for /api/admin, ORG_ADMIN of the organization for members).
 */

export type GlobalRole = 'USER' | 'SYSTEM_ADMIN'
export type MembershipRole = 'MEMBER' | 'ORG_ADMIN'
export type UserStatus = 'ACTIVE' | 'DISABLED'
export type OrganizationStatus = 'ACTIVE' | 'ARCHIVED'
export type RoomStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED'

export interface AdminUser {
  id: string
  email: string
  displayName: string
  globalRole: GlobalRole
  status: UserStatus
  hasPassword: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  memberships: { organizationId: string; role: MembershipRole }[]
}

export interface AdminOrganization {
  id: string
  name: string
  status: OrganizationStatus
  memberCount: number
}

export interface RoomFields {
  name: string
  description: string | null
  location: string | null
  capacity: number | null
  color: string
  defaultPermission: Permission
  status?: RoomStatus
  /** With status DISABLED or ARCHIVED: also cancel the room's future bookings. */
  cancelFutureBookings?: boolean
}

export interface AdminRoom extends RoomFields {
  id: string
  status: RoomStatus
  access: { organizationId: string; permission: Permission }[]
  /** All bookings in the room, past and cancelled ones included. */
  bookingCount: number
}

export interface Member {
  userId: string
  displayName: string
  email: string
  role: MembershipRole
  status: UserStatus
}

/** A future approved booking or open request that a deactivation may cancel. */
export interface FutureBooking {
  id: string
  title: string
  start: string
  end: string
  status: BookingStatus
  roomName: string | null
  organizationName: string | null
  requestedByName: string | null
}

export interface OrgInvitation {
  id: string
  email: string
  role: MembershipRole
  invitedByName: string | null
  createdAt: string
}

/** ADDED: the person is a member now (`temporaryPassword` when a new account was created). INVITED: they must accept first. */
export type AddMemberResult =
  | { result: 'ADDED'; member: Member; temporaryPassword: string | null }
  | { result: 'INVITED'; member: null; temporaryPassword: null }

const api = createApiClient()
const id = encodeURIComponent

export const adminApi = {
  users: () => api.get<AdminUser[]>('/api/admin/users'),
  createUser: (body: { email: string; displayName: string; globalRole: GlobalRole; memberships: { organizationId: string; role: MembershipRole }[] }) =>
    api.post<{ user: AdminUser; temporaryPassword: string }>('/api/admin/users', body),
  /** Disabling always cancels the user's future requests; `cancelFutureBookings` also their approved bookings. */
  updateUser: (
    userId: string,
    body: Partial<Pick<AdminUser, 'email' | 'displayName' | 'globalRole' | 'status'>> & { cancelFutureBookings?: boolean },
  ) =>
    api.patch<AdminUser>(`/api/admin/users/${id(userId)}`, body),
  resetPassword: (userId: string) => api.post<{ temporaryPassword: string }>(`/api/admin/users/${id(userId)}/reset-password`),
  setMembership: (userId: string, organizationId: string, role: MembershipRole) =>
    api.put<AdminUser>(`/api/admin/users/${id(userId)}/memberships/${id(organizationId)}`, { role }),
  removeMembership: async (userId: string, organizationId: string) => {
    await api.send('DELETE', `/api/admin/users/${id(userId)}/memberships/${id(organizationId)}`)
  },

  organizations: () => api.get<AdminOrganization[]>('/api/admin/organizations'),
  createOrganization: (name: string) => api.post<AdminOrganization>('/api/admin/organizations', { name }),
  /** Archiving deletes pending invitations; `cancelFutureBookings` also cancels the organization's future bookings. */
  updateOrganization: (orgId: string, body: { name?: string; status?: OrganizationStatus; cancelFutureBookings?: boolean }) =>
    api.patch<AdminOrganization>(`/api/admin/organizations/${id(orgId)}`, body),

  rooms: () => api.get<AdminRoom[]>('/api/admin/rooms'),
  createRoom: (body: RoomFields) => api.post<AdminRoom>('/api/admin/rooms', body),
  updateRoom: (roomId: string, body: RoomFields) => api.put<AdminRoom>(`/api/admin/rooms/${id(roomId)}`, body),
  /** A room with bookings must be archived first (409 otherwise); its bookings are then deleted with it. */
  deleteRoom: async (roomId: string) => {
    await api.send('DELETE', `/api/admin/rooms/${id(roomId)}`)
  },
  setRoomAccess: (roomId: string, organizationId: string, permission: Permission | null) =>
    api.put<AdminRoom>(`/api/admin/rooms/${id(roomId)}/access/${id(organizationId)}`, { permission }),

  /** Future approved bookings and open requests in a room, of an organization, or requested by a user. */
  futureBookings: (kind: 'rooms' | 'organizations' | 'users', targetId: string) =>
    api.get<FutureBooking[]>(`/api/admin/${kind}/${id(targetId)}/future-bookings`),
}

export const membersApi = {
  list: (orgId: string) => api.get<Member[]>(`/api/organizations/${id(orgId)}/members`),
  add: (orgId: string, body: { email: string; displayName: string; role: MembershipRole }) =>
    api.post<AddMemberResult>(`/api/organizations/${id(orgId)}/members`, body),
  setRole: (orgId: string, userId: string, role: MembershipRole) =>
    api.put<Member>(`/api/organizations/${id(orgId)}/members/${id(userId)}`, { role }),
  /** Also withdraws the person's future requests for the organization. */
  remove: async (orgId: string, userId: string) => {
    await api.send('DELETE', `/api/organizations/${id(orgId)}/members/${id(userId)}`)
  },
  invitations: (orgId: string) => api.get<OrgInvitation[]>(`/api/organizations/${id(orgId)}/invitations`),
  withdrawInvitation: async (orgId: string, invitationId: string) => {
    await api.send('DELETE', `/api/organizations/${id(orgId)}/invitations/${id(invitationId)}`)
  },
}

export const roleLabels: Record<MembershipRole, string> = { MEMBER: 'Medlem', ORG_ADMIN: 'Organisasjonsadministrator' }
export const roomStatusLabels: Record<RoomStatus, string> = { ACTIVE: 'Aktiv', DISABLED: 'Stengt', ARCHIVED: 'Arkivert' }
