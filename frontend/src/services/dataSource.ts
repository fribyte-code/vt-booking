import type { AppData, Booking, CreateBookingInput } from '../types'

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

  createBooking(input: CreateBookingInput): Promise<Booking>
  approveBooking(booking: Booking): Promise<Booking>
  rejectBooking(booking: Booking, reason: string): Promise<Booking>
  cancelBooking(booking: Booking): Promise<Booking>
  markDecisionsSeen(): Promise<void>

  /** Real login and logout. API mode only. */
  auth?: {
    login(email: string, password: string): Promise<void>
    logout(): Promise<void>
  }

  /** Simulated users and resettable data. Demo mode only. */
  demo?: {
    switchUser(userId: string): void
    reset(): Promise<void>
  }
}
