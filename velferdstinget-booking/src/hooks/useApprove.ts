import { useState } from 'react'
import { errorMessage } from '../lib/errors'
import type { Booking } from '../types'
import { useApp } from './useApp'

/** Approves a request and reports the outcome as a toast. */
export function useApprove() {
  const app = useApp()
  const [busyId, setBusyId] = useState<string | null>(null)

  const approve = async (booking: Booking): Promise<boolean> => {
    setBusyId(booking.id)
    try {
      await app.approveBooking(booking.id)
      app.notify(`«${booking.title}» er godkjent og bekreftet.`)
      return true
    } catch (err) {
      app.notify(errorMessage(err), 'error')
      return false
    } finally {
      setBusyId(null)
    }
  }

  return { approve, busyId }
}
