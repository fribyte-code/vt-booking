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

/** The calendar's visible period. Bookings are loaded for it. */
export interface DateRange {
  start: string
  end: string
}

/**
 * Where the app's data comes from: the Spring Boot API, with a session cookie and CSRF
 * (`apiDataSource.ts`). The UI only talks to this interface.
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
  /** Bookings overlapping the range (at most 62 days), in one room or all of them. */
  listBookings(range: DateRange, roomId?: string): Promise<Booking[]>

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

  /** Login and logout. */
  auth: {
    login(email: string, password: string): Promise<void>
    logout(): Promise<void>
    /** True when the last session check found a temporary password that must be changed first. */
    passwordChangeRequired(): boolean
    changePassword(currentPassword: string, newPassword: string): Promise<void>
  }

  /** Answering invitations to organizations (listed in `AppData.invitations`). */
  invitations: {
    accept(id: string): Promise<void>
    decline(id: string): Promise<void>
  }
}
