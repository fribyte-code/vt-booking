import { MoveRight } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { formatDate, formatTimeRange } from '../../lib/dates'
import type { EditResult } from '../../services/bookingRules'
import type { Booking, UpdateBookingInput } from '../../types'
import { Button } from '../ui/Button'
import { Alert } from '../ui/fields'
import { Modal } from '../ui/Modal'

export interface PendingMove {
  booking: Booking
  input: UpdateBookingInput
  check: Extract<EditResult, { ok: true }>
  revert: () => void
}

/**
 * Confirms a drag or resize in the calendar when it does more than move the booking: it changes
 * the status (e.g. an approved booking becomes a request again), or it moves one occurrence of a series.
 */
export function MoveBookingDialog({
  move,
  onConfirm,
  onClose,
}: {
  move: PendingMove
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const { booking, input, check } = move
  const org = app.organization(booking.organizationId)

  const confirm = async () => {
    setBusy(true)
    await onConfirm()
  }

  return (
    <Modal
      title={`Flytte «${booking.title}»?`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={confirm} disabled={busy} data-autofocus>
            <MoveRight className="size-4" /> Flytt
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          <span className="line-through decoration-slate-400">
            {formatDate(booking.start)} {formatTimeRange(booking.start, booking.end)}
          </span>
          <br />
          <span className="font-medium text-slate-900 first-letter:uppercase">
            {formatDate(input.start)} {formatTimeRange(input.start, input.end)}
          </span>
        </p>
        {check.losesApproval && (
          <Alert tone="warning">
            {app.roomOf(booking).name} krever godkjenning for {org?.name ?? 'organisasjonen'}. Bookingen blir en ny søknad, og
            tidsrommet holdes ikke av før en administrator har godkjent den.
          </Alert>
        )}
        {!check.losesApproval && check.status === 'PENDING' && booking.status === 'PENDING' && (
          <Alert tone="info">Søknaden flyttes og venter fortsatt på behandling.</Alert>
        )}
        {check.status === 'APPROVED' && booking.status === 'PENDING' && (
          <Alert tone="success">Organisasjonen kan nå booke rommet direkte, så bookingen bekreftes med en gang.</Alert>
        )}
        {booking.seriesId && (
          <Alert tone="info">
            Bookingen er del av en gjentakende serie. Bare denne forekomsten flyttes. Vil du flytte flere, åpner du bookingen og
            velger «Endre».
          </Alert>
        )}
      </div>
    </Modal>
  )
}
