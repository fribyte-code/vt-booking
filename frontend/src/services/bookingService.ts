import { createSeedData } from '../data/mockData'
import type { AppData, Booking, CreateBookingInput, User } from '../types'
import { BookingError } from './bookingError'
import { evaluateBooking, findConflicts } from './bookingRules'

export { BookingError }

/**
 * Demo booking service over a key-value store (localStorage in the browser,
 * in-memory in tests). It plays the role of the Spring Boot API in demo mode
 * and enforces the same rules, so the UI behaves alike in both modes.
 * `actorId` stands in for the session user, which the real API takes from
 * the session instead. Only `demoDataSource.ts` uses it at runtime, so it is
 * left out of API builds together with the mock data.
 */

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORAGE_KEY = 'vt-booking:data:v1'

function newId(): string {
  return `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createBookingService(store: KeyValueStore, now: () => Date = () => new Date()) {
  function load(): AppData {
    const raw = store.getItem(STORAGE_KEY)
    if (raw) {
      try {
        return JSON.parse(raw) as AppData
      } catch {
        // Corrupt data falls through to a fresh seed.
      }
    }
    const seed = createSeedData(now())
    save(seed)
    return seed
  }

  function save(data: AppData) {
    store.setItem(STORAGE_KEY, JSON.stringify(data))
  }

  function requireUser(data: AppData, userId: string): User {
    const user = data.users.find((u) => u.id === userId)
    if (!user) throw new BookingError('NOT_FOUND', 'Ukjent bruker.')
    return user
  }

  function requireAdmin(data: AppData, userId: string): User {
    const user = requireUser(data, userId)
    if (user.role !== 'ADMIN') {
      throw new BookingError('FORBIDDEN', 'Bare administratorer kan behandle søknader.')
    }
    return user
  }

  function requireBooking(data: AppData, id: string): Booking {
    const booking = data.bookings.find((b) => b.id === id)
    if (!booking) throw new BookingError('NOT_FOUND', 'Bookingen finnes ikke.')
    return booking
  }

  function requirePending(booking: Booking) {
    if (booking.status !== 'PENDING') {
      throw new BookingError('INVALID_STATE', 'Søknaden er allerede behandlet.')
    }
  }

  return {
    async getData(): Promise<AppData> {
      return load()
    },

    async createBooking(actorId: string, input: CreateBookingInput): Promise<Booking> {
      const data = load()
      const user = requireUser(data, actorId)
      const result = evaluateBooking(data, user, input, now())
      if (!result.ok) throw new BookingError(result.code, result.message)

      const isDirect = result.permission === 'DIRECT'
      const booking: Booking = {
        id: newId(),
        roomId: input.roomId,
        organizationId: input.organizationId,
        requestedById: user.id,
        title: input.title.trim(),
        description: input.description?.trim() || undefined,
        start: new Date(input.start).toISOString(),
        end: new Date(input.end).toISOString(),
        status: isDirect ? 'APPROVED' : 'PENDING',
        requiresApproval: !isDirect,
        createdAt: now().toISOString(),
      }
      data.bookings.push(booking)
      save(data)
      return booking
    },

    async approveBooking(actorId: string, bookingId: string): Promise<Booking> {
      const data = load()
      const admin = requireAdmin(data, actorId)
      const booking = requireBooking(data, bookingId)
      requirePending(booking)

      if (Date.parse(booking.start) < now().getTime()) {
        throw new BookingError('INVALID_STATE', 'Tidspunktet har allerede passert og kan ikke godkjennes.')
      }
      const conflict = findConflicts(data.bookings, booking.roomId, booking.start, booking.end, booking.id)[0]
      if (conflict) {
        const org = data.organizations.find((o) => o.id === conflict.organizationId)
        throw new BookingError(
          'CONFLICT',
          `Kan ikke godkjennes: rommet er allerede booket av ${org?.name ?? 'en annen organisasjon'} («${conflict.title}») i dette tidsrommet.`,
        )
      }

      Object.assign(booking, {
        status: 'APPROVED',
        decidedAt: now().toISOString(),
        decidedById: admin.id,
        decisionSeen: false,
      } satisfies Partial<Booking>)
      save(data)
      return booking
    },

    async rejectBooking(actorId: string, bookingId: string, reason: string): Promise<Booking> {
      const data = load()
      const admin = requireAdmin(data, actorId)
      const booking = requireBooking(data, bookingId)
      requirePending(booking)
      if (!reason.trim()) {
        throw new BookingError('VALIDATION', 'Skriv en begrunnelse for avslaget.')
      }

      Object.assign(booking, {
        status: 'REJECTED',
        decidedAt: now().toISOString(),
        decidedById: admin.id,
        decisionComment: reason.trim(),
        decisionSeen: false,
      } satisfies Partial<Booking>)
      save(data)
      return booking
    },

    async cancelBooking(actorId: string, bookingId: string): Promise<Booking> {
      const data = load()
      const user = requireUser(data, actorId)
      const booking = requireBooking(data, bookingId)

      if (booking.requestedById !== user.id && user.role !== 'ADMIN') {
        throw new BookingError('FORBIDDEN', 'Du kan bare kansellere dine egne bookinger.')
      }
      if (booking.status !== 'APPROVED' && booking.status !== 'PENDING') {
        throw new BookingError('INVALID_STATE', 'Bookingen er allerede avsluttet.')
      }
      if (Date.parse(booking.start) < now().getTime()) {
        throw new BookingError('INVALID_STATE', 'Bookinger som har startet kan ikke kanselleres.')
      }

      Object.assign(booking, {
        status: 'CANCELLED',
        cancelledAt: now().toISOString(),
        cancelledById: user.id,
      } satisfies Partial<Booking>)
      save(data)
      return booking
    },

    async markDecisionsSeen(userId: string): Promise<void> {
      const data = load()
      for (const b of data.bookings) {
        if (b.requestedById === userId && b.decidedAt) b.decisionSeen = true
      }
      save(data)
    },

    async resetDemoData(): Promise<AppData> {
      store.removeItem(STORAGE_KEY)
      return load()
    },
  }
}

export type BookingService = ReturnType<typeof createBookingService>
