import { BookingError } from '../services/bookingService'

export function errorMessage(error: unknown): string {
  return error instanceof BookingError ? error.message : 'Noe gikk galt. Prøv igjen.'
}
