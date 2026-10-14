import { Check, X } from 'lucide-react'
import { useId, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { formatDate, formatTimeRange } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import type { Booking, SeriesApproved } from '../../types'
import { Button } from '../ui/Button'
import { Alert, Field, Textarea } from '../ui/fields'
import { Modal } from '../ui/Modal'

/**
 * An administrator approves or rejects a request, or with `wholeSeries` every open request in its
 * series. A rejection needs a reason; an approval may have a comment. Both are shown to the requester.
 * Approving a series reports the occurrences that could not be approved (e.g. taken in the meantime).
 */
export function DecisionDialog({
  booking,
  decision,
  wholeSeries,
  onClose,
}: {
  booking: Booking
  decision: 'approve' | 'reject'
  /** Decide every open request in the booking's series. The number is shown in the dialog. */
  wholeSeries?: { count: number }
  onClose: () => void
}) {
  const app = useApp()
  const id = useId()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SeriesApproved | null>(null)
  const approving = decision === 'approve'
  const seriesId = wholeSeries ? booking.seriesId : undefined

  const submit = async () => {
    if (!approving && !comment.trim()) {
      setError('Skriv en begrunnelse for avslaget.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (seriesId && approving) {
        const outcome = await app.approveSeries(seriesId, comment)
        app.notify(`${outcome.approved.length} ${outcome.approved.length === 1 ? 'søknad' : 'søknader'} i serien er godkjent.`)
        if (outcome.notApproved.length > 0) {
          setResult(outcome)
          return
        }
      } else if (seriesId) {
        const rejected = await app.rejectSeries(seriesId, comment)
        app.notify(`${rejected.length} ${rejected.length === 1 ? 'søknad' : 'søknader'} i serien er avslått.`, 'info')
      } else if (approving) {
        await app.approveBooking(booking.id, comment)
        app.notify(`«${booking.title}» er godkjent og bekreftet.`)
      } else {
        await app.rejectBooking(booking.id, comment)
        app.notify(`Søknaden «${booking.title}» er avslått.`, 'info')
      }
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Modal
        title="Noen søknader ble ikke godkjent"
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            Lukk
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            {result.approved.length} av {result.approved.length + result.notApproved.length} søknader i «{booking.title}» er
            godkjent. Disse står fortsatt som ventende:
          </p>
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {result.notApproved.map((n) => (
              <li key={n.id} className="px-3 py-2">
                <p className="font-medium text-slate-900 first-letter:uppercase">
                  {formatDate(n.start)} <span className="tabular-nums">{formatTimeRange(n.start, n.end)}</span>
                </p>
                <p className="text-xs text-red-700">{n.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    )
  }

  const subject = seriesId ? (approving ? 'Godkjenn hele serien' : 'Avslå hele serien') : approving ? 'Godkjenn søknad' : 'Avslå søknad'

  return (
    <Modal
      title={subject}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          {approving ? (
            <Button variant="success" onClick={submit} disabled={busy}>
              <Check className="size-4" /> {seriesId ? 'Godkjenn alle' : 'Godkjenn'}
            </Button>
          ) : (
            <Button variant="primary" className="bg-red-600 hover:bg-red-700" onClick={submit} disabled={busy}>
              <X className="size-4" /> {seriesId ? 'Avslå alle' : 'Avslå søknad'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{booking.title}</span> · {app.roomOf(booking).name} ·{' '}
          {wholeSeries
            ? `${wholeSeries.count} ventende ${wholeSeries.count === 1 ? 'søknad' : 'søknader'} i serien`
            : `${formatDate(booking.start)} ${formatTimeRange(booking.start, booking.end)}`}
        </p>
        {seriesId && approving && (
          <p className="text-xs text-slate-500">
            Hver søknad sjekkes for seg. Er et tidspunkt allerede booket, blir den søknaden stående og vises etterpå.
          </p>
        )}
        <Field
          label={approving ? 'Kommentar (valgfritt)' : 'Begrunnelse'}
          htmlFor={id}
          hint={approving ? 'Kommentaren vises for den som søkte.' : 'Begrunnelsen vises for den som søkte.'}
        >
          <Textarea
            id={id}
            required={!approving}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder={approving ? 'F.eks. «Husk å låse døren etterpå.»' : undefined}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
