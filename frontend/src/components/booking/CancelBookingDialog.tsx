import { useId, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { formatDate, formatTimeRange } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import type { Booking } from '../../types'
import { Button } from '../ui/Button'
import { Alert, Field, Textarea } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { ScopeChoice } from './ScopeChoice'

type Scope = 'single' | 'following' | 'all'

/**
 * Cancels a booking or withdraws a request, with an optional reason. When someone else's booking
 * is cancelled (an organization or system administrator), the requester is notified and sees the reason.
 * For an occurrence of a series, the user picks whether the following or all future occurrences go too.
 */
export function CancelBookingDialog({
  booking,
  onClose,
  onCancelled,
}: {
  booking: Booking
  onClose: () => void
  onCancelled?: () => void
}) {
  const app = useApp()
  const id = useId()
  const [reason, setReason] = useState('')
  const [scope, setScope] = useState<Scope>('single')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = booking.status === 'PENDING'
  const someoneElses = booking.requestedById !== app.currentUser.id
  const requester = booking.requestedByName ?? app.user(booking.requestedById)?.name
  const series = scope !== 'single' && booking.seriesId

  const cancel = async () => {
    if (someoneElses && !reason.trim()) {
      setError('Skriv en begrunnelse, så den som booket vet hvorfor.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (booking.seriesId && scope !== 'single') {
        const cancelled = await app.cancelSeries(booking.seriesId, {
          fromId: scope === 'following' ? booking.id : undefined,
          reason,
        })
        app.notify(
          cancelled.length === 1 ? '1 booking i serien er kansellert.' : `${cancelled.length} bookinger i serien er kansellert.`,
          'info',
        )
      } else {
        await app.cancelBooking(booking.id, reason)
        app.notify(`«${booking.title}» er ${pending ? 'trukket tilbake' : 'kansellert'}.`, 'info')
      }
      onCancelled?.()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={series ? 'Kanseller bookinger i serien?' : pending ? 'Trekk tilbake søknad?' : 'Kanseller booking?'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" className="bg-red-600 hover:bg-red-700" onClick={cancel} disabled={busy}>
            {series ? 'Kanseller' : pending ? 'Trekk tilbake' : 'Kanseller'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          «{booking.title}» i {app.roomOf(booking).name}, {formatDate(booking.start)}{' '}
          {formatTimeRange(booking.start, booking.end)}. Tidsrommet blir ledig for andre.
        </p>
        {booking.seriesId && (
          <ScopeChoice<Scope>
            legend="Gjentakende booking"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'single', label: 'Bare denne' },
              { value: 'following', label: 'Denne og alle følgende' },
              { value: 'all', label: 'Hele serien (fremtidige)', hint: 'Alle kommende bookinger i serien, også før denne.' },
            ]}
          />
        )}
        <Field
          label={someoneElses ? 'Begrunnelse' : 'Begrunnelse (valgfritt)'}
          htmlFor={id}
          hint={someoneElses ? `${requester ?? 'Den som booket'} får beskjed og ser begrunnelsen.` : undefined}
        >
          <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
