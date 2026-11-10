import type {
  AppData,
  Booking,
  BookingStatus,
  Invitation,
  OccurrenceSlot,
  OpeningHoursEntry,
  Organization,
  Permission,
  Room,
  SeriesApproved,
  TimeSlot,
  User,
} from '../types'
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
  managedRoomIds: string[]
}

interface RoomResponse {
  id: string
  name: string
  description: string | null
  location: string | null
  capacity: number | null
  color: string
  status: 'ACTIVE' | 'DISABLED'
  permissions: { organizationId: string; permission: Permission }[]
  openingHours: OpeningHoursEntry[]
  managingOrganizationId: string | null
}

interface BookingResponse {
  id: string
  roomId: string
  /** Also set for archived rooms, which /api/rooms leaves out. */
  roomName: string | null
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
  cancelledById: string | null
  cancelledByName: string | null
  cancellationReason: string | null
  updatedAt: string | null
  updatedByName: string | null
  seriesId: string | null
  version: number
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

function toUser(me: MeResponse): User {
  return {
    id: me.id,
    name: me.displayName,
    email: me.email,
    role: me.globalRole === 'SYSTEM_ADMIN' ? 'ADMIN' : 'USER',
    organizationIds: me.memberships.map((m) => m.organizationId),
    orgAdminOrganizationIds: me.memberships.filter((m) => m.role === 'ORG_ADMIN').map((m) => m.organizationId),
    managedRoomIds: me.managedRoomIds ?? [],
  }
}

function toRoom(r: RoomResponse): Room {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    location: r.location ?? '',
    capacity: r.capacity ?? undefined,
    color: r.color,
    status: r.status,
    permissions: Object.fromEntries(r.permissions.map((p) => [p.organizationId, p.permission])),
    openingHours: r.openingHours ?? [],
    managingOrganizationId: r.managingOrganizationId ?? null,
  }
}

/** When something happened to the booking that its requester should hear about, if anything. */
function newsAtOf(b: BookingResponse): string | null {
  // A cancellation by someone else is news for the requester too, from the time it happened.
  const cancelledByOther = !!b.cancelledById && b.cancelledById !== b.requestedById
  return b.status === 'CANCELLED' && cancelledByOther ? b.cancelledAt : b.decidedAt
}

/**
 * Whether the requester has seen the news. `seenUntil` is the newest news time they marked as read
 * in this browser. Without one (first login here), news about bookings that have already ended
 * counts as seen, so a new device doesn't list the whole history.
 */
function isSeen(b: BookingResponse, seenUntil: string): boolean {
  const newsAt = newsAtOf(b)
  if (!newsAt) return false
  if (!seenUntil) return Date.parse(b.end) <= Date.now()
  return Date.parse(newsAt) <= Date.parse(seenUntil)
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
    decisionSeen: isSeen(b, seenUntil),
    cancelledAt: b.cancelledAt ?? undefined,
    cancelledById: b.cancelledById ?? undefined,
    cancelledByName: b.cancelledByName ?? undefined,
    cancellationReason: b.cancellationReason ?? undefined,
    updatedAt: b.updatedAt ?? undefined,
    updatedByName: b.updatedByName ?? undefined,
    seriesId: b.seriesId ?? undefined,
    roomName: b.roomName ?? undefined,
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
  // The /api/me answer of the session check, used once by the load that follows it.
  let sessionMe: MeResponse | null = null
  // The newest news time among the bookings last loaded, i.e. what the user can have seen.
  let latestNewsAt = ''

  const map = (b: BookingResponse) => toBooking(b, readSeen(userId ?? ''))
  const id = encodeURIComponent
  const blankToUndefined = (text?: string) => text?.trim() || undefined

  const decide = (booking: Booking, action: 'approve' | 'reject' | 'cancel', extra: object = {}) =>
    api
      .post<BookingResponse>(`/api/bookings/${id(booking.id)}/${action}`, {
        version: booking.version,
        ...extra,
      })
      .then(map)

  return {
    async getSessionUserId() {
      try {
        const me = await api.get<MeResponse>('/api/me')
        userId = me.id
        mustChangePassword = me.mustChangePassword
        sessionMe = me
      } catch (err) {
        sessionMe = null
        if ((err as { code?: string }).code === 'UNAUTHENTICATED') {
          mustChangePassword = false
          return (userId = null)
        }
        throw err
      }
      return userId
    },

    async load(range) {
      const me = sessionMe ?? (await api.get<MeResponse>('/api/me'))
      sessionMe = null
      userId = me.id
      const isAdmin = me.globalRole === 'SYSTEM_ADMIN'
      // System admins and room managers get the approval queue (a manager's holds only their rooms).
      const decides = isAdmin || (me.managedRoomIds ?? []).length > 0
      const { start, end } = clamp(range)
      const query = new URLSearchParams({ from: start, to: end })

      const [rooms, organizations, calendar, mine, requests, invitations, publicRequests] = await Promise.all([
        api.get<RoomResponse[]>('/api/rooms'),
        api.get<{ id: string; name: string }[]>('/api/organizations'),
        api.get<BookingResponse[]>(`/api/bookings?${query}`),
        api.get<BookingResponse[]>('/api/bookings/mine'),
        decides ? api.get<BookingResponse[]>('/api/bookings/requests') : Promise.resolve([]),
        api.get<Invitation[]>('/api/me/invitations'),
        isAdmin ? api.get<{ count: number }>('/api/admin/public-requests/count') : Promise.resolve(null),
      ])

      const seenUntil = readSeen(me.id)
      const bookings = new Map<string, Booking>()
      latestNewsAt = ''
      for (const b of [...calendar, ...mine, ...requests]) {
        bookings.set(b.id, toBooking(b, seenUntil))
        const newsAt = b.requestedById === me.id ? newsAtOf(b) : null
        if (newsAt && (!latestNewsAt || Date.parse(newsAt) > Date.parse(latestNewsAt))) latestNewsAt = newsAt
      }

      const orgs = new Map<string, Organization>(
        organizations.map((o) => [o.id, { id: o.id, name: o.name, description: '' }]),
      )
      // Archived organizations are left out of the directory but may still own bookings.
      for (const b of [...calendar, ...mine, ...requests]) {
        if (!orgs.has(b.organizationId) && b.organizationName) {
          orgs.set(b.organizationId, { id: b.organizationId, name: b.organizationName, description: '', archived: true })
        }
      }

      return {
        // Only the signed-in user: other people's names come with the bookings (requestedByName and so on).
        users: [toUser(me)],
        organizations: [...orgs.values()],
        rooms: rooms.map(toRoom),
        bookings: [...bookings.values()],
        invitations,
        newPublicRequests: publicRequests?.count,
      } satisfies AppData
    },

    async listBookings(range, roomId) {
      const { start, end } = clamp(range)
      const query = new URLSearchParams({ from: start, to: end, ...(roomId ? { roomId } : {}) })
      const found = await api.get<BookingResponse[]>(`/api/bookings?${query}`)
      const seenUntil = readSeen(userId ?? '')
      return found.map((b) => toBooking(b, seenUntil))
    },

    async createBooking(input) {
      return map(await api.post<BookingResponse>('/api/bookings', input))
    },
    approveBooking: (booking, comment) => decide(booking, 'approve', { comment: blankToUndefined(comment) }),
    rejectBooking: (booking, reason) => decide(booking, 'reject', { reason }),
    cancelBooking: (booking, reason) => decide(booking, 'cancel', { reason: blankToUndefined(reason) }),
    async updateBooking(booking, input) {
      const updated = await api.put<BookingResponse>(`/api/bookings/${id(booking.id)}`, {
        version: booking.version,
        roomId: input.roomId,
        title: input.title,
        description: blankToUndefined(input.description),
        start: input.start,
        end: input.end,
      })
      return map(updated)
    },

    series: {
      async preview(input) {
        const result = await api.post<{ occurrences: (TimeSlot & { conflict: boolean })[] }>(
          '/api/bookings/series/preview',
          { ...input, description: blankToUndefined(input.description), skipConflicts: undefined },
        )
        return result.occurrences
      },
      async create(input) {
        const result = await api.post<{ seriesId: string; created: BookingResponse[]; skipped: TimeSlot[] }>(
          '/api/bookings/series',
          { ...input, description: blankToUndefined(input.description), skipConflicts: input.skipConflicts || undefined },
        )
        return { seriesId: result.seriesId, created: result.created.map(map), skipped: result.skipped }
      },
      async list(seriesId) {
        return (await api.get<BookingResponse[]>(`/api/bookings/series/${id(seriesId)}`)).map(map)
      },
      async update(from, input, options = {}) {
        const result = await api.put<{ updated: BookingResponse[]; skipped: OccurrenceSlot[] }>(
          `/api/bookings/series/${id(from.seriesId ?? '')}`,
          {
            fromBookingId: from.id,
            version: from.version,
            roomId: input.roomId,
            title: input.title,
            description: blankToUndefined(input.description),
            start: input.start,
            end: input.end,
            skipConflicts: options.skipConflicts || undefined,
            dryRun: options.dryRun || undefined,
          },
        )
        return { updated: result.updated.map(map), skipped: result.skipped }
      },
      async cancel(seriesId, { from, reason }) {
        const cancelled = await api.post<BookingResponse[]>(`/api/bookings/series/${id(seriesId)}/cancel`, {
          fromBookingId: from?.id,
          reason: blankToUndefined(reason),
        })
        return cancelled.map(map)
      },
      async approve(seriesId, comment) {
        const result = await api.post<{ approved: BookingResponse[]; notApproved: SeriesApproved['notApproved'] }>(
          `/api/bookings/series/${id(seriesId)}/approve`,
          { comment: blankToUndefined(comment) },
        )
        return { approved: result.approved.map(map), notApproved: result.notApproved }
      },
      async reject(seriesId, reason) {
        return (await api.post<BookingResponse[]>(`/api/bookings/series/${id(seriesId)}/reject`, { reason })).map(map)
      },
    },

    invitations: {
      async accept(invitationId) {
        await api.post<MeResponse>(`/api/me/invitations/${id(invitationId)}/accept`)
      },
      async decline(invitationId) {
        await api.send('POST', `/api/me/invitations/${id(invitationId)}/decline`)
      },
    },

    async markDecisionsSeen() {
      if (!userId) return
      // Up to the newest news the user was shown, not "now": a decision made after the last load
      // must not be marked as read without having been seen. Server timestamps, so no clock skew.
      const previous = readSeen(userId)
      const until = latestNewsAt && (!previous || Date.parse(latestNewsAt) > Date.parse(previous)) ? latestNewsAt : previous
      if (!until) return
      try {
        localStorage.setItem(SEEN_KEY + userId, until)
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
        mustChangePassword = false
        sessionMe = null
      },
      passwordChangeRequired: () => mustChangePassword,
      async changePassword(currentPassword, newPassword) {
        await api.send('POST', '/api/me/password', { currentPassword, newPassword })
        mustChangePassword = false
        sessionMe = null
      },
    },
  }
}
