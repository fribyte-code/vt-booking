import type { AppData, Booking, BookingStatus, Organization, Permission, Room, User } from '../types'
import { type ApiClient, createApiClient } from './apiClient'
import type { DataSource, DateRange } from './dataSource'

// Response shapes of the Spring Boot API (backend/README.md).

interface MeResponse {
  id: string
  email: string
  displayName: string
  globalRole: 'USER' | 'SYSTEM_ADMIN'
  mustChangePassword: boolean
  memberships: { organizationId: string; organizationName: string; role: string }[]
}

interface RoomResponse {
  id: string
  name: string
  description: string | null
  location: string | null
  capacity: number | null
  color: string
  permissions: { organizationId: string; permission: Permission }[]
}

interface BookingResponse {
  id: string
  roomId: string
  organizationId: string
  organizationName: string | null
  requestedById: string | null
  requestedByName: string | null
  title: string
  description: string | null
  start: string
  end: string
  status: BookingStatus
  requiresApproval: boolean
  createdAt: string
  decidedAt: string | null
  decidedByName: string | null
  decisionComment: string | null
  cancelledAt: string | null
  version: number
}

interface AdminUserResponse {
  id: string
  email: string
  displayName: string
  globalRole: 'USER' | 'SYSTEM_ADMIN'
  memberships: { organizationId: string; role: string }[]
}

/** The API caps calendar queries at 62 days. */
const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000
const SEEN_KEY = 'vt-booking:decisions-seen:'

function readSeen(userId: string): string {
  try {
    return localStorage.getItem(SEEN_KEY + userId) ?? ''
  } catch {
    return ''
  }
}

function toUser(me: MeResponse | AdminUserResponse): User {
  return {
    id: me.id,
    name: me.displayName,
    email: me.email,
    role: me.globalRole === 'SYSTEM_ADMIN' ? 'ADMIN' : 'USER',
    organizationIds: me.memberships.map((m) => m.organizationId),
    orgAdminOrganizationIds: me.memberships.filter((m) => m.role === 'ORG_ADMIN').map((m) => m.organizationId),
  }
}

function toRoom(r: RoomResponse): Room {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    location: r.location ?? '',
    capacity: r.capacity ?? 0,
    color: r.color,
    permissions: Object.fromEntries(r.permissions.map((p) => [p.organizationId, p.permission])),
  }
}

function toBooking(b: BookingResponse, seenUntil: string): Booking {
  return {
    id: b.id,
    roomId: b.roomId,
    organizationId: b.organizationId,
    // Hidden for other organizations' bookings; '' never matches a user.
    requestedById: b.requestedById ?? '',
    requestedByName: b.requestedByName ?? undefined,
    title: b.title,
    description: b.description ?? undefined,
    start: b.start,
    end: b.end,
    status: b.status,
    requiresApproval: b.requiresApproval,
    createdAt: b.createdAt,
    decidedAt: b.decidedAt ?? undefined,
    decidedByName: b.decidedByName ?? undefined,
    decisionComment: b.decisionComment ?? undefined,
    // The API has no notifications yet, so "seen" is remembered per browser.
    decisionSeen: !!b.decidedAt && Date.parse(b.decidedAt) <= Date.parse(seenUntil),
    cancelledAt: b.cancelledAt ?? undefined,
    version: b.version,
  }
}

function clamp(range: DateRange): DateRange {
  const start = Date.parse(range.start)
  const end = Math.min(Date.parse(range.end), start + MAX_RANGE_MS)
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
}

/** The Spring Boot API. Identity, permissions and every booking rule are enforced there. */
export function createApiDataSource(api: ApiClient = createApiClient()): DataSource {
  let userId: string | null = null
  let mustChangePassword = false

  const decide = (booking: Booking, action: 'approve' | 'reject' | 'cancel', extra: object = {}) =>
    api
      .post<BookingResponse>(`/api/bookings/${encodeURIComponent(booking.id)}/${action}`, {
        version: booking.version,
        ...extra,
      })
      .then((b) => toBooking(b, readSeen(userId ?? '')))

  return {
    async getSessionUserId() {
      try {
        const me = await api.get<MeResponse>('/api/me')
        userId = me.id
        mustChangePassword = me.mustChangePassword
      } catch (err) {
        if ((err as { code?: string }).code === 'UNAUTHENTICATED') return (userId = null)
        throw err
      }
      return userId
    },

    async load(range) {
      const me = await api.get<MeResponse>('/api/me')
      userId = me.id
      const isAdmin = me.globalRole === 'SYSTEM_ADMIN'
      const { start, end } = clamp(range)
      const query = new URLSearchParams({ from: start, to: end })

      const [rooms, organizations, calendar, mine, requests, users] = await Promise.all([
        api.get<RoomResponse[]>('/api/rooms'),
        api.get<{ id: string; name: string }[]>('/api/organizations'),
        api.get<BookingResponse[]>(`/api/bookings?${query}`),
        api.get<BookingResponse[]>('/api/bookings/mine'),
        isAdmin ? api.get<BookingResponse[]>('/api/bookings/requests') : Promise.resolve([]),
        isAdmin ? api.get<AdminUserResponse[]>('/api/admin/users') : Promise.resolve([]),
      ])

      const seenUntil = readSeen(me.id)
      const bookings = new Map<string, Booking>()
      for (const b of [...calendar, ...mine, ...requests]) bookings.set(b.id, toBooking(b, seenUntil))

      const orgs = new Map<string, Organization>(
        organizations.map((o) => [o.id, { id: o.id, name: o.name, description: '' }]),
      )
      // Archived organizations are left out of the directory but may still own bookings.
      for (const b of [...calendar, ...mine, ...requests]) {
        if (!orgs.has(b.organizationId) && b.organizationName) {
          orgs.set(b.organizationId, { id: b.organizationId, name: b.organizationName, description: '' })
        }
      }

      const meUser = toUser(me)
      return {
        users: isAdmin ? users.map((u) => (u.id === me.id ? meUser : toUser(u))) : [meUser],
        organizations: [...orgs.values()],
        rooms: rooms.map(toRoom),
        bookings: [...bookings.values()],
      } satisfies AppData
    },

    async createBooking(input) {
      const created = await api.post<BookingResponse>('/api/bookings', input)
      return toBooking(created, readSeen(userId ?? ''))
    },
    approveBooking: (booking) => decide(booking, 'approve'),
    rejectBooking: (booking, reason) => decide(booking, 'reject', { reason }),
    cancelBooking: (booking) => decide(booking, 'cancel'),

    async markDecisionsSeen() {
      if (!userId) return
      try {
        localStorage.setItem(SEEN_KEY + userId, new Date().toISOString())
      } catch {
        // Notifications are a convenience; without storage they just stay unread.
      }
    },

    auth: {
      async login(email, password) {
        await api.login(email, password)
      },
      async logout() {
        await api.logout()
        userId = null
      },
      passwordChangeRequired: () => mustChangePassword,
      async changePassword(currentPassword, newPassword) {
        await api.send('POST', '/api/me/password', { currentPassword, newPassword })
        mustChangePassword = false
      },
    },
  }
}
