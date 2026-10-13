import type { Permission } from '../types'
import { createApiClient } from './apiClient'

/**
 * User, organization and room management against the Spring Boot API. API mode only: the
 * management pages that use it are not rendered in the demo build, and the server enforces
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
}

export interface AdminRoom extends RoomFields {
  id: string
  status: RoomStatus
  access: { organizationId: string; permission: Permission }[]
}

export interface Member {
  userId: string
  displayName: string
  email: string
  role: MembershipRole
  status: UserStatus
}

const api = createApiClient()
const id = encodeURIComponent

export const adminApi = {
  users: () => api.get<AdminUser[]>('/api/admin/users'),
  createUser: (body: { email: string; displayName: string; globalRole: GlobalRole; memberships: { organizationId: string; role: MembershipRole }[] }) =>
    api.post<{ user: AdminUser; temporaryPassword: string }>('/api/admin/users', body),
  updateUser: (userId: string, body: Partial<Pick<AdminUser, 'email' | 'displayName' | 'globalRole' | 'status'>>) =>
    api.patch<AdminUser>(`/api/admin/users/${id(userId)}`, body),
  resetPassword: (userId: string) => api.post<{ temporaryPassword: string }>(`/api/admin/users/${id(userId)}/reset-password`),
  setMembership: (userId: string, organizationId: string, role: MembershipRole) =>
    api.put<AdminUser>(`/api/admin/users/${id(userId)}/memberships/${id(organizationId)}`, { role }),
  removeMembership: async (userId: string, organizationId: string) => {
    await api.send('DELETE', `/api/admin/users/${id(userId)}/memberships/${id(organizationId)}`)
  },

  organizations: () => api.get<AdminOrganization[]>('/api/admin/organizations'),
  createOrganization: (name: string) => api.post<AdminOrganization>('/api/admin/organizations', { name }),
  updateOrganization: (orgId: string, body: { name?: string; status?: OrganizationStatus }) =>
    api.patch<AdminOrganization>(`/api/admin/organizations/${id(orgId)}`, body),

  rooms: () => api.get<AdminRoom[]>('/api/admin/rooms'),
  createRoom: (body: RoomFields) => api.post<AdminRoom>('/api/admin/rooms', body),
  updateRoom: (roomId: string, body: RoomFields) => api.put<AdminRoom>(`/api/admin/rooms/${id(roomId)}`, body),
  setRoomAccess: (roomId: string, organizationId: string, permission: Permission | null) =>
    api.put<AdminRoom>(`/api/admin/rooms/${id(roomId)}/access/${id(organizationId)}`, { permission }),
}

export const membersApi = {
  list: (orgId: string) => api.get<Member[]>(`/api/organizations/${id(orgId)}/members`),
  add: (orgId: string, body: { email: string; displayName: string; role: MembershipRole }) =>
    api.post<{ member: Member; accountCreated: boolean; temporaryPassword: string | null }>(
      `/api/organizations/${id(orgId)}/members`,
      body,
    ),
  setRole: (orgId: string, userId: string, role: MembershipRole) =>
    api.put<Member>(`/api/organizations/${id(orgId)}/members/${id(userId)}`, { role }),
  remove: async (orgId: string, userId: string) => {
    await api.send('DELETE', `/api/organizations/${id(orgId)}/members/${id(userId)}`)
  },
}

export const roleLabels: Record<MembershipRole, string> = { MEMBER: 'Medlem', ORG_ADMIN: 'Organisasjonsadministrator' }
export const roomStatusLabels: Record<RoomStatus, string> = { ACTIVE: 'Aktiv', DISABLED: 'Stengt', ARCHIVED: 'Arkivert' }
