import { useId, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { formatDate, formatTimeRange } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import type { Booking } from '../../types'
import { Button } from '../ui/Button'
import { Alert, Field, Textarea } from '../ui/fields'
import { Modal } from '../ui/Modal'

export function RejectDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const app = useApp()
  const id = useId()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reject = async () => {
    setBusy(true)
    try {
      await app.rejectBooking(booking.id, comment)
      app.notify(`Søknaden «${booking.title}» er avslått.`, 'info')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Avslå søknad"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" className="bg-red-600 hover:bg-red-700" onClick={reject} disabled={busy}>
            Avslå søknad
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{booking.title}</span> ·{' '}
          {app.room(booking.roomId)?.name} · {formatDate(booking.start)} {formatTimeRange(booking.start, booking.end)}
        </p>
        <Field label="Begrunnelse (valgfritt)" htmlFor={id} hint="Begrunnelsen vises for den som søkte.">
          <Textarea id={id} value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={300} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
