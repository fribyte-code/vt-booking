import { CalendarPlus, ChevronDown, Inbox, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import { crossesMidnight, formatDate, formatDateTime, formatTimeRange } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { adminApi, type PublicRequest } from '../../services/adminApi'
import { bookingDescription, formatPhone, replyMailto, requestedRoom } from '../../services/publicRequests'
import { EmptyState } from '../booking/BookingListItem'
import { NightBadge } from '../booking/badges'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert } from '../ui/fields'
import { Chip } from './Chip'
import { useAdminData } from './useAdminData'

const statusLabels = {
  NEW: 'Ny',
  TRANSFERRED: 'Overført',
  REJECTED: 'Avslått',
} as const

/**
 * System administrators: requests for Studentvillaen from the public form (/soknad). "Opprett
 * booking" opens the ordinary booking dialog prefilled; the request is marked as transferred
 * only when the booking is created.
 */
export function PublicRequestsAdmin() {
  const app = useApp()
  const load = useCallback(() => adminApi.publicRequests(), [])
  const { data: requests, error, reload } = useAdminData(load)
  const [rejecting, setRejecting] = useState<PublicRequest | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!requests) return <p className="text-sm text-slate-500">Laster forespørsler …</p>

  const open = requests.filter((r) => r.status === 'NEW').sort((a, b) => a.start.localeCompare(b.start))
  const handled = requests.filter((r) => r.status !== 'NEW')

  const createBooking = (r: PublicRequest) => {
    setActionError(null)
    app.openBookingDialog({
      start: r.start,
      end: r.end,
      // No room for "Ingen preferanse" or a room that is gone or closed: the admin picks one.
      roomId: requestedRoom(app.data.rooms, r)?.id ?? '',
      title: r.eventName,
      description: bookingDescription(r),
      publicRequestId: r.id,
      onCreated: reload,
    })
  }

  const reject = async (r: PublicRequest) => {
    try {
      await adminApi.rejectPublicRequest(r.id)
      app.notify('Forespørselen er avslått.')
    } catch (err) {
      setActionError(errorMessage(err))
    }
    setRejecting(null)
    reload()
    app.reload()
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Forespørsler om fellesarealene i Studentvillaen sendt fra det offentlige skjemaet på{' '}
        <a href="/soknad" target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">
          /soknad
        </a>
        . Søkeren får ikke beskjed automatisk; svar på e-post.
      </p>
      {actionError && <Alert tone="error">{actionError}</Alert>}

      {open.length === 0 ? (
        <EmptyState icon={<Inbox />} title="Ingen nye forespørsler" />
      ) : (
        <ul className="space-y-3">
          {open.map((r) => (
            <RequestItem
              key={r.id}
              request={r}
              actions={
                <>
                  <Button size="sm" onClick={() => setRejecting(r)}>
                    <X className="size-4" /> Avslå
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => createBooking(r)}>
                    <CalendarPlus className="size-4" /> Opprett booking
                  </Button>
                </>
              }
            />
          ))}
        </ul>
      )}

      {handled.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Behandlet</h2>
          <ul className="space-y-3">
            {handled.map((r) => (
              <RequestItem key={r.id} request={r} />
            ))}
          </ul>
        </section>
      )}

      {rejecting && (
        <ConfirmDialog
          title="Avslå forespørselen?"
          confirmLabel="Avslå"
          destructive
          onConfirm={() => reject(rejecting)}
          onClose={() => setRejecting(null)}
        >
          Forespørselen fra {rejecting.organizationName} markeres som avslått. Søkeren får ikke beskjed automatisk, så
          gi beskjed på e-post til {rejecting.email}.
        </ConfirmDialog>
      )}
    </div>
  )
}

function RequestItem({ request: r, actions }: { request: PublicRequest; actions?: ReactNode }) {
  const app = useApp()
  // The admin made the booking, so it is among their own loaded bookings (the last 90 days and on).
  const booking = r.bookingId ? app.data.bookings.find((b) => b.id === r.bookingId) : undefined
  const [expanded, setExpanded] = useState(false)
  const [now] = useState(() => Date.now())
  // Whether the collapsed description is cut off: only then is there anything to expand.
  const descriptionRef = useRef<HTMLParagraphElement>(null)
  const [clamped, setClamped] = useState(false)
  useEffect(() => {
    const el = descriptionRef.current
    if (!el) return
    // Fires once on observe and again when the width changes (e.g. rotating a phone).
    const observer = new ResizeObserver(() => setClamped(el.scrollHeight > el.clientHeight + 1))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const passed = r.status === 'NEW' && Date.parse(r.start) <= now

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-slate-900">
            <span className="inline-block first-letter:uppercase">{formatDate(r.start)}</span>,{' '}
            {formatTimeRange(r.start, r.end)}
          </span>
          <Chip
            label={statusLabels[r.status]}
            tone={r.status === 'NEW' ? 'dark' : r.status === 'REJECTED' ? 'red' : 'default'}
          />
          {passed && <Chip label="Tidspunktet har passert" tone="amber" />}
          {crossesMidnight(r.start, r.end) && <NightBadge />}
        </div>
        {/* Exactly what the applicant sent, whatever organization the booking gets. */}
        <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <Detail label="Organisasjon">{r.organizationName}</Detail>
          <Detail label="Arrangementets navn">{r.eventName}</Detail>
          <Detail label="Kontakt-e-post">
            <a
              href={replyMailto(r, booking && { roomName: app.roomOf(booking).name, start: booking.start, end: booking.end })}
              className="text-blue-700 hover:underline"
              title="Åpner et ferdig utfylt svar i e-postprogrammet"
            >
              {r.email}
            </a>
          </Detail>
          <Detail label="Medlem av Kulturstyret/Studentersamfunnet">
            {r.memberOfKulturstyretOrSamfunnet ? 'Ja' : 'Nei'}
          </Detail>
          <Detail label="Ønsket rom">{r.preferredRoomName ?? 'Ingen preferanse'}</Detail>
          <Detail label="Dato og tid">
            <span className="inline-block first-letter:uppercase">{formatDate(r.start)}</span>,{' '}
            {formatTimeRange(r.start, r.end)}
            {crossesMidnight(r.start, r.end) && ` (slutter ${formatDate(r.end)})`}
          </Detail>
          {r.contacts.length > 0 && (
            <Detail label="Ansvarlige">
              <ul className="space-y-1">
                {r.contacts.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium">{c.name}</span> ({c.organization}) · kortnr. {c.cardNumber} ·{' '}
                    <a href={`tel:${c.phone}`} className="text-blue-700 hover:underline">
                      {formatPhone(c.phone)}
                    </a>
                  </li>
                ))}
              </ul>
            </Detail>
          )}
          <Detail label="Beskrivelse">
            <p ref={descriptionRef} className={cn('whitespace-pre-line', !expanded && 'line-clamp-3')}>
              {r.description}
            </p>
            {(clamped || expanded) && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
              >
                <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
                {expanded ? 'Vis mindre' : 'Vis hele beskrivelsen'}
              </button>
            )}
          </Detail>
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          Sendt {formatDateTime(r.createdAt)}
          {r.status === 'TRANSFERRED' && (r.bookingId ? ' · Overført til booking' : ' · Bookingen er slettet')}
        </p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2 sm:self-start">{actions}</div>}
    </li>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-800">{children}</dd>
    </>
  )
}
