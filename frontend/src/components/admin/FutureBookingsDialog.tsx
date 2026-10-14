import { type ReactNode, useState } from 'react'
import { formatDate, formatTimeRange } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import type { FutureBooking } from '../../services/adminApi'
import { StatusBadge } from '../booking/badges'
import { Button } from '../ui/Button'
import { Alert } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { useAdminData } from './useAdminData'

/**
 * Before deactivating a room, an organization or a user: shows the future bookings it affects and
 * makes the administrator choose explicitly whether to cancel or keep them. There is no default.
 * `choiceApplies` limits the choice to some bookings (for users: approved ones; their open
 * requests are always withdrawn, which `alwaysCancelledNote` explains).
 */
export function FutureBookingsDialog({
  title,
  intro,
  load,
  choiceApplies = () => true,
  alwaysCancelledNote,
  onConfirm,
  onClose,
}: {
  title: string
  intro: ReactNode
  load: () => Promise<FutureBooking[]>
  choiceApplies?: (booking: FutureBooking) => boolean
  alwaysCancelledNote?: ReactNode
  onConfirm: (cancelFutureBookings: boolean) => Promise<void>
  onClose: () => void
}) {
  // Loaded once when the dialog opens.
  const [loadOnce] = useState(() => load)
  const { data: bookings, error: loadError } = useAdminData(loadOnce)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (cancel: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(cancel)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const choosable = bookings?.filter(choiceApplies) ?? []
  // Without the list (it failed to load), still let the administrator choose explicitly.
  const mustChoose = !!loadError || choosable.length > 0
  const ready = !!bookings || !!loadError

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="mr-auto">
            Avbryt
          </Button>
          {ready &&
            (mustChoose ? (
              <>
                <Button onClick={() => confirm(false)} disabled={busy}>
                  Behold bookingene
                </Button>
                <Button variant="primary" className="bg-red-600 hover:bg-red-700" onClick={() => confirm(true)} disabled={busy}>
                  Kanseller bookingene
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => confirm(false)} disabled={busy} data-autofocus>
                Fortsett
              </Button>
            ))}
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-600">
        <div>{intro}</div>
        {!ready && <p className="text-slate-500">Henter kommende bookinger …</p>}
        {loadError && (
          <Alert tone="warning">Kunne ikke hente kommende bookinger ({loadError}). Velg likevel hva som skal skje med dem.</Alert>
        )}
        {bookings && bookings.length === 0 && <p>Ingen kommende bookinger eller søknader berøres.</p>}
        {bookings && bookings.length > 0 && (
          <>
            <p className="font-medium text-slate-900">
              {bookings.length} kommende {bookings.length === 1 ? 'booking eller søknad' : 'bookinger og søknader'} berøres:
            </p>
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200">
              {bookings.map((b) => (
                <li key={b.id} className="flex items-start gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{b.title}</span>
                    <span className="block text-xs text-slate-500">
                      <span className="first-letter:uppercase">{formatDate(b.start, { weekday: false })}</span>{' '}
                      <span className="tabular-nums">{formatTimeRange(b.start, b.end)}</span>
                      {[b.roomName, b.organizationName].filter(Boolean).map((t) => ` · ${t}`)}
                    </span>
                  </span>
                  <StatusBadge booking={b} />
                </li>
              ))}
            </ul>
            {alwaysCancelledNote && <Alert tone="info">{alwaysCancelledNote}</Alert>}
            {choosable.length > 0 && (
              <p>
                {choosable.length === bookings.length
                  ? 'Velg om de skal kanselleres eller beholdes.'
                  : `Velg om ${choosable.length === 1 ? 'den godkjente bookingen' : `de ${choosable.length} godkjente bookingene`} skal kanselleres eller beholdes.`}{' '}
                Den som booket, får beskjed om kanselleringen.
              </p>
            )}
          </>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
