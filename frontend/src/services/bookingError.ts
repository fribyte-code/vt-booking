import type { ErrorCode } from './bookingRules'

/** A taken time reported with a series conflict. `id` is set when an existing occurrence would move there. */
export interface ConflictSlot {
  id?: string
  start: string
  end: string
}

/** A rule or API error whose message is safe to show to the user. */
export class BookingError extends Error {
  code: ErrorCode
  /** Series only: the occurrences whose time is taken (Problem Details `conflicts`). */
  conflicts?: ConflictSlot[]

  constructor(code: ErrorCode, message: string, conflicts?: ConflictSlot[]) {
    super(message)
    this.name = 'BookingError'
    this.code = code
    this.conflicts = conflicts
  }
}
