import { createSeedData } from '../data/mockData'
import type {
  AppData,
  Booking,
  CreateBookingInput,
  CreateSeriesInput,
  OccurrenceSlot,
  SeriesApproved,
  SeriesCreated,
  SeriesPreviewOccurrence,
  SeriesUpdated,
  SeriesUpdateOptions,
  TimeSlot,
  UpdateBookingInput,
  User,
} from '../types'
import { BookingError } from './bookingError'
import {
  canChangeBooking,
  type EditResult,
  evaluateBooking,
  evaluateEdit,
  findConflicts,
  isExpiredRequest,
  isOpenForChanges,
  seriesOccurrences,
} from './bookingRules'
import type { DateRange } from './dataSource'

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

function newId(prefix = 'bk'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Local wall-clock time as if it were UTC, so shifts can be measured in local time across DST. */
function localMs(iso: string): number {
  const d = new Date(iso)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())
}

function fromLocalMs(ms: number): string {
  const u = new Date(ms)
  return new Date(
    u.getUTCFullYear(),
    u.getUTCMonth(),
    u.getUTCDate(),
    u.getUTCHours(),
    u.getUTCMinutes(),
    u.getUTCSeconds(),
  ).toISOString()
}

const sameSlot = (a: TimeSlot, b: TimeSlot) => Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end)

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

  /** Like the API, other organizations only see approved bookings. */
  function isVisible(booking: Booking, user: User): boolean {
    return booking.status === 'APPROVED' || user.role === 'ADMIN' || user.organizationIds.includes(booking.organizationId)
  }

  function visibleOccurrences(data: AppData, user: User, seriesId: string): Booking[] {
    const found = data.bookings
      .filter((b) => b.seriesId === seriesId && isVisible(b, user))
      .sort((a, b) => a.start.localeCompare(b.start))
    if (found.length === 0) throw new BookingError('NOT_FOUND', 'Serien finnes ikke.')
    return found
  }

  /** Open occurrences of a series from `fromStart` on (all future ones without it). */
  function openOccurrences(data: AppData, seriesId: string, fromStart?: string): Booking[] {
    return data.bookings
      .filter(
        (b) =>
          b.seriesId === seriesId &&
          isOpenForChanges(b, now().getTime()) &&
          (!fromStart || Date.parse(b.start) >= Date.parse(fromStart)),
      )
      .sort((a, b) => a.start.localeCompare(b.start))
  }

  function anchorOf(occurrences: Booking[], bookingId: string): Booking {
    const anchor = occurrences.find((b) => b.id === bookingId)
    if (!anchor) throw new BookingError('NOT_FOUND', 'Bookingen finnes ikke i serien.')
    return anchor
  }

  function cancel(booking: Booking, user: User, reason?: string) {
    Object.assign(booking, {
      status: 'CANCELLED',
      cancelledAt: now().toISOString(),
      cancelledById: user.id,
      cancellationReason: reason?.trim() || undefined,
      // A cancellation by someone else is news for the requester.
      decisionSeen: user.id === booking.requestedById ? booking.decisionSeen : false,
    } satisfies Partial<Booking>)
  }

  /** Applies a checked edit, like the backend's `editText` and `applyMove`. */
  function applyEdit(booking: Booking, input: UpdateBookingInput, result: Extract<EditResult, { ok: true }>, user: User) {
    booking.title = input.title.trim()
    booking.description = input.description?.trim() || undefined
    booking.updatedAt = now().toISOString()
    booking.updatedById = user.id
    if (!result.moved) return

    const requiresApproval = result.permission === 'REQUEST'
    // A system administrator keeps an approved booking approved, with its decision (if any) unchanged.
    const keepDecision = requiresApproval && result.status === 'APPROVED'
    Object.assign(booking, {
      roomId: input.roomId,
      start: new Date(input.start).toISOString(),
      end: new Date(input.end).toISOString(),
      status: result.status,
      requiresApproval,
    } satisfies Partial<Booking>)
    if (!keepDecision) {
      Object.assign(booking, { decidedAt: undefined, decidedById: undefined, decisionComment: undefined, decisionSeen: undefined })
    }
  }

  /** Membership, room permission and times of a series, without looking at conflicts. */
  function planSeries(data: AppData, user: User, input: CreateSeriesInput): TimeSlot[] {
    const plan = seriesOccurrences(input, input.recurrence, now())
    if (!plan.ok) throw new BookingError(plan.code, plan.message)
    const first = evaluateBooking({ ...data, bookings: [] }, user, { ...input, ...plan.slots[0] }, now())
    if (!first.ok) throw new BookingError(first.code, first.message)
    return plan.slots
  }

  const isTaken = (data: AppData, roomId: string, slot: TimeSlot) =>
    findConflicts(data.bookings, roomId, slot.start, slot.end).length > 0

  return {
    async getData(): Promise<AppData> {
      return load()
    },

    /** The data as one user sees it: like the API, other organizations' requests are hidden. */
    async getDataFor(userId: string): Promise<AppData> {
      const data = load()
      const user = data.users.find((u) => u.id === userId)
      return user ? { ...data, bookings: data.bookings.filter((b) => isVisible(b, user)) } : data
    },

    /** Approved bookings and unexpired requests in one room, overlapping the range (like GET /api/bookings). */
    async listBookings(range: DateRange, roomId: string): Promise<Booking[]> {
      const from = Date.parse(range.start)
      const to = Date.parse(range.end)
      return load().bookings.filter(
        (b) =>
          b.roomId === roomId &&
          (b.status === 'APPROVED' || (b.status === 'PENDING' && !isExpiredRequest(b, now().getTime()))) &&
          Date.parse(b.start) < to &&
          from < Date.parse(b.end),
      )
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

    async approveBooking(actorId: string, bookingId: string, comment?: string): Promise<Booking> {
      const data = load()
      const admin = requireAdmin(data, actorId)
      const booking = requireBooking(data, bookingId)
      requirePending(booking)

      if (isExpiredRequest(booking, now().getTime())) {
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
        decisionComment: comment?.trim() || undefined,
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

    async cancelBooking(actorId: string, bookingId: string, reason?: string): Promise<Booking> {
      const data = load()
      const user = requireUser(data, actorId)
      const booking = requireBooking(data, bookingId)

      if (!canChangeBooking(user, booking)) {
        throw new BookingError('FORBIDDEN', 'Du har ikke lov til å kansellere denne bookingen.')
      }
      if (booking.status !== 'APPROVED' && booking.status !== 'PENDING') {
        throw new BookingError('INVALID_STATE', 'Bookingen er allerede avsluttet.')
      }
      if (Date.parse(booking.start) <= now().getTime()) {
        throw new BookingError('INVALID_STATE', 'Bookinger som har startet kan ikke kanselleres.')
      }

      cancel(booking, user, reason)
      save(data)
      return booking
    },

    async updateBooking(actorId: string, bookingId: string, input: UpdateBookingInput): Promise<Booking> {
      const data = load()
      const user = requireUser(data, actorId)
      const booking = requireBooking(data, bookingId)
      if (!isVisible(booking, user)) throw new BookingError('NOT_FOUND', 'Bookingen finnes ikke.')
      const result = evaluateEdit(data, user, booking, input, now())
      if (!result.ok) throw new BookingError(result.code, result.message)
      applyEdit(booking, input, result, user)
      save(data)
      return booking
    },

    async previewSeries(actorId: string, input: CreateSeriesInput): Promise<SeriesPreviewOccurrence[]> {
      const data = load()
      const slots = planSeries(data, requireUser(data, actorId), input)
      return slots.map((slot) => ({ ...slot, conflict: isTaken(data, input.roomId, slot) }))
    },

    async createSeries(actorId: string, input: CreateSeriesInput): Promise<SeriesCreated> {
      const data = load()
      const user = requireUser(data, actorId)
      const slots = planSeries(data, user, input)
      const room = data.rooms.find((r) => r.id === input.roomId)!
      const taken = slots.filter((slot) => isTaken(data, input.roomId, slot))
      if (taken.length > 0 && (!input.skipConflicts || taken.length === slots.length)) {
        throw new BookingError(
          'CONFLICT',
          taken.length === slots.length
            ? `Alle tidspunktene i serien er opptatt i ${room.name}.`
            : `${taken.length} av ${slots.length} tidspunkter i serien er opptatt i ${room.name}.`,
          taken,
        )
      }

      const seriesId = newId('series')
      const isDirect = room.permissions[input.organizationId] === 'DIRECT'
      const created = slots
        .filter((slot) => !taken.includes(slot))
        .map(
          (slot): Booking => ({
            id: newId(),
            roomId: input.roomId,
            organizationId: input.organizationId,
            requestedById: user.id,
            title: input.title.trim(),
            description: input.description?.trim() || undefined,
            start: slot.start,
            end: slot.end,
            status: isDirect ? 'APPROVED' : 'PENDING',
            requiresApproval: !isDirect,
            createdAt: now().toISOString(),
            seriesId,
          }),
        )
      data.bookings.push(...created)
      save(data)
      return { seriesId, created, skipped: taken }
    },

    async listSeries(actorId: string, seriesId: string): Promise<Booking[]> {
      const data = load()
      return visibleOccurrences(data, requireUser(data, actorId), seriesId)
    },

    /**
     * Edits an occurrence and the following open ones by the same local-time shift and duration,
     * like the backend's `BookingSeriesService.update`. Taken times fail the edit, or with
     * `skipConflicts` leave those occurrences unchanged.
     */
    async updateSeries(
      actorId: string,
      seriesId: string,
      fromBookingId: string,
      input: UpdateBookingInput,
      options: SeriesUpdateOptions = {},
    ): Promise<SeriesUpdated> {
      const data = load()
      const user = requireUser(data, actorId)
      const anchor = anchorOf(visibleOccurrences(data, user, seriesId), fromBookingId)
      const anchorCheck = evaluateEdit({ ...data, bookings: [] }, user, anchor, input, now())
      if (!anchorCheck.ok && anchorCheck.code !== 'CONFLICT') throw new BookingError(anchorCheck.code, anchorCheck.message)

      const targets = openOccurrences(data, seriesId, anchor.start)
      if (targets.some((b) => !canChangeBooking(user, b))) {
        throw new BookingError('FORBIDDEN', 'Du har ikke lov til å endre alle disse bookingene i serien.')
      }
      // The start moves by the anchor's shift in local time; the end is that start plus the anchor's
      // new duration in absolute time (as the backend does, so it may differ by an hour across DST).
      const shift = localMs(input.start) - localMs(anchor.start)
      const length = Date.parse(input.end) - Date.parse(input.start)
      const plan = new Map<Booking, TimeSlot>(
        targets.map((b) => {
          if (b === anchor) return [b, { start: input.start, end: input.end }]
          const start = fromLocalMs(localMs(b.start) + shift)
          return [b, { start, end: new Date(Date.parse(start) + length).toISOString() }]
        }),
      )
      const moving = new Set(targets.filter((b) => b.roomId !== input.roomId || !sameSlot(plan.get(b)!, b)))

      // Moving occurrences leave their old slots, so they don't block each other; a skipped one
      // stays where it is and may then block another, so repeat until nothing changes.
      const skipped = new Set<Booking>()
      const results = new Map<Booking, Extract<EditResult, { ok: true }>>()
      for (let changed = true; changed; ) {
        changed = false
        const others = data.bookings.filter((b) => !moving.has(b) || skipped.has(b))
        for (const b of targets) {
          if (skipped.has(b)) continue
          const result = evaluateEdit({ ...data, bookings: others }, user, b, { ...input, ...plan.get(b)! }, now())
          if (result.ok) {
            results.set(b, result)
          } else if (result.code === 'CONFLICT') {
            skipped.add(b)
            changed = true
          } else {
            throw new BookingError(result.code, result.message)
          }
        }
      }

      const skippedSlots: OccurrenceSlot[] = targets
        .filter((b) => skipped.has(b))
        .map((b) => ({ id: b.id, ...plan.get(b)! }))
      if (skippedSlots.length > 0 && (!options.skipConflicts || skippedSlots.length === targets.length)) {
        const roomName = data.rooms.find((r) => r.id === input.roomId)?.name ?? 'rommet'
        throw new BookingError(
          'CONFLICT',
          skippedSlots.length === targets.length
            ? `Alle de nye tidspunktene er opptatt i ${roomName}.`
            : `${skippedSlots.length} av ${targets.length} nye tidspunkter er opptatt i ${roomName}.`,
          skippedSlots,
        )
      }

      const updated = targets.filter((b) => !skipped.has(b))
      for (const b of updated) applyEdit(b, { ...input, ...plan.get(b)! }, results.get(b)!, user)
      // A dry run reports the result without saving it; `load()` returned a fresh copy.
      if (!options.dryRun) save(data)
      return { updated, skipped: skippedSlots }
    },

    async cancelSeries(actorId: string, seriesId: string, fromBookingId?: string, reason?: string): Promise<Booking[]> {
      const data = load()
      const user = requireUser(data, actorId)
      const visible = visibleOccurrences(data, user, seriesId)
      const from = fromBookingId ? anchorOf(visible, fromBookingId).start : undefined
      const targets = openOccurrences(data, seriesId, from)
      if (targets.length === 0) {
        throw new BookingError('INVALID_STATE', 'Serien har ingen kommende bookinger som kan kanselleres.')
      }
      if (targets.some((b) => !canChangeBooking(user, b))) {
        throw new BookingError('FORBIDDEN', 'Du har ikke lov til å kansellere alle disse bookingene i serien.')
      }
      for (const b of targets) cancel(b, user, reason)
      save(data)
      return targets
    },

    async approveSeries(actorId: string, seriesId: string, comment?: string): Promise<SeriesApproved> {
      const data = load()
      const admin = requireAdmin(data, actorId)
      const pending = openOccurrences(data, seriesId).filter((b) => b.status === 'PENDING')
      if (pending.length === 0) throw new BookingError('INVALID_STATE', 'Serien har ingen ubehandlede søknader.')

      const result: SeriesApproved = { approved: [], notApproved: [] }
      for (const b of pending) {
        // Checked one by one, so an occurrence approved here blocks a later overlapping one.
        if (findConflicts(data.bookings, b.roomId, b.start, b.end, b.id).length > 0) {
          result.notApproved.push({
            id: b.id,
            start: b.start,
            end: b.end,
            code: 'CONFLICT',
            reason: 'Rommet er allerede booket i dette tidsrommet.',
          })
          continue
        }
        Object.assign(b, {
          status: 'APPROVED',
          decidedAt: now().toISOString(),
          decidedById: admin.id,
          decisionComment: comment?.trim() || undefined,
          decisionSeen: false,
        } satisfies Partial<Booking>)
        result.approved.push(b)
      }
      save(data)
      return result
    },

    async rejectSeries(actorId: string, seriesId: string, reason: string): Promise<Booking[]> {
      const data = load()
      const admin = requireAdmin(data, actorId)
      if (!reason.trim()) throw new BookingError('VALIDATION', 'Skriv en begrunnelse for avslaget.')
      const pending = openOccurrences(data, seriesId).filter((b) => b.status === 'PENDING')
      if (pending.length === 0) throw new BookingError('INVALID_STATE', 'Serien har ingen ubehandlede søknader.')
      for (const b of pending) {
        Object.assign(b, {
          status: 'REJECTED',
          decidedAt: now().toISOString(),
          decidedById: admin.id,
          decisionComment: reason.trim(),
          decisionSeen: false,
        } satisfies Partial<Booking>)
      }
      save(data)
      return pending
    },

    async markDecisionsSeen(userId: string): Promise<void> {
      const data = load()
      for (const b of data.bookings) {
        if (b.requestedById === userId && (b.decidedAt || b.cancelledAt)) b.decisionSeen = true
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
