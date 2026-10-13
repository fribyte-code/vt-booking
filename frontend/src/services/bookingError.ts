import type { ErrorCode } from './bookingRules'

/** A rule or API error whose message is safe to show to the user. */
export class BookingError extends Error {
  code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'BookingError'
    this.code = code
  }
}
