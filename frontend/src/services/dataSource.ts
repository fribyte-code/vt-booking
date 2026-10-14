import type {
  AppData,
  Booking,
  CreateBookingInput,
  CreateSeriesInput,
  SeriesApproved,
  SeriesCreated,
  SeriesPreviewOccurrence,
  SeriesUpdated,
  SeriesUpdateOptions,
  UpdateBookingInput,
} from '../types'

/** The calendar's visible period. The API source loads bookings for it; the demo source has everything. */
export interface DateRange {
  start: string
  end: string
}

/**
 * Where the app's data comes from. The UI only talks to this interface, so the
 * same components run on either implementation:
 *
 * - `demoDataSource.ts`: mock users and data in localStorage, with a simulated user switcher.
 * - `apiDataSource.ts`: the Spring Boot API, with a session cookie and CSRF.
 *
 * Which one is used is fixed at build time by `VITE_DATA_MODE` (see `index.ts`).
 * Methods throw `BookingError`; code `UNAUTHENTICATED` means the session has ended.
 */
export interface DataSource {
  /** The signed-in user's id, or null when a login is needed. */
  getSessionUserId(): Promise<string | null>
  load(range: DateRange): Promise<AppData>
  /**
   * Approved bookings and unexpired requests the user may see in one room, overlapping the range.
   * For checking availability outside the loaded calendar range.
   */
  listBookings(range: DateRange, roomId: string): Promise<Booking[]>

  createBooking(input: CreateBookingInput): Promise<Booking>
  approveBooking(booking: Booking, comment?: string): Promise<Booking>
  rejectBooking(booking: Booking, reason: string): Promise<Booking>
  cancelBooking(booking: Booking, reason?: string): Promise<Booking>
  /** New room, time, title or description. A new room or time may change the status (see `statusAfterMove`). */
  updateBooking(booking: Booking, input: UpdateBookingInput): Promise<Booking>
  markDecisionsSeen(): Promise<void>

  /** Weekly series. Every occurrence is an ordinary booking with the same `seriesId`. */
  series: {
    /** What `create` would book, with taken times marked. Writes nothing. */
    preview(input: CreateSeriesInput): Promise<SeriesPreviewOccurrence[]>
    /** Fails with CONFLICT (and `conflicts`) when a time is taken, unless `skipConflicts` is set. */
    create(input: CreateSeriesInput): Promise<SeriesCreated>
    /** The occurrences the user may see, by start. */
    list(seriesId: string): Promise<Booking[]>
    /** Edits `from` and the following open occurrences by the same local shift and duration. */
    update(from: Booking, input: UpdateBookingInput, options?: SeriesUpdateOptions): Promise<SeriesUpdated>
    /** Every future occurrence, or with `from` that one and the following. */
    cancel(seriesId: string, options: { from?: Booking; reason?: string }): Promise<Booking[]>
    /** Administrators: decide every open request in the series. */
    approve(seriesId: string, comment?: string): Promise<SeriesApproved>
    reject(seriesId: string, reason: string): Promise<Booking[]>
  }

  /** Real login and logout. API mode only. */
  auth?: {
    login(email: string, password: string): Promise<void>
    logout(): Promise<void>
    /** True when the last session check found a temporary password that must be changed first. */
    passwordChangeRequired(): boolean
    changePassword(currentPassword: string, newPassword: string): Promise<void>
  }

  /** Answering invitations to organizations (listed in `AppData.invitations`). API mode only. */
  invitations?: {
    accept(id: string): Promise<void>
    decline(id: string): Promise<void>
  }

  /** Simulated users and resettable data. Demo mode only. */
  demo?: {
    switchUser(userId: string): void
    reset(): Promise<void>
  }
}
