import { AlignLeft, Ban, Building2, Check, ChevronDown, Clock, Gavel, MapPin, Pencil, Repeat, User, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import { formatDate, formatDateTime, formatShortDate, formatTimeRange } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { canChangeBooking, findConflicts, isExpiredRequest, isOpenForChanges } from '../../services/bookingRules'
import type { Booking } from '../../types'
import { Button } from '../ui/Button'
import { Alert } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { AddToCalendar } from './AddToCalendar'
import { CancelBookingDialog } from './CancelBookingDialog'
import { DecisionDialog } from './DecisionDialog'
import { RoomDot, StatusBadge } from './badges'

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <span className="mt-0.5 text-slate-400 [&>svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1 text-sm text-slate-700">{children}</div>
    </div>
  )
}

type Mode = 'view' | 'cancel' | 'approve' | 'reject' | 'approve-series' | 'reject-series'

export function BookingDetailsDialog({ bookingId }: { bookingId: string }) {
  const app = useApp()
  const [mode, setMode] = useState<Mode>('view')
  // Open requests in the whole series (fetched by SeriesSection), not only the loaded ones.
  const [seriesOpenCount, setSeriesOpenCount] = useState(0)

  const booking = app.data.bookings.find((b) => b.id === bookingId)
  if (!booking) return null

  const room = app.roomOf(booking)
  const org = app.organization(booking.organizationId)
  const requesterName = app.user(booking.requestedById)?.name ?? booking.requestedByName
  const deciderName = (booking.decidedById ? app.user(booking.decidedById)?.name : undefined) ?? booking.decidedByName
  const cancellerName =
    (booking.cancelledById ? app.user(booking.cancelledById)?.name : undefined) ?? booking.cancelledByName
  const editorName = (booking.updatedById ? app.user(booking.updatedById)?.name : undefined) ?? booking.updatedByName
  const isAdmin = app.currentUser.role === 'ADMIN'
  const expired = isExpiredRequest(booking)
  // The requester, the organization's administrators and system administrators (the backend checks this too).
  const canChange = canChangeBooking(app.currentUser, booking) && isOpenForChanges(booking)
  const canDecide = isAdmin && booking.status === 'PENDING' && !expired
  const conflicts =
    booking.status === 'PENDING' ? findConflicts(app.data.bookings, booking.roomId, booking.start, booking.end, booking.id) : []

  if (mode === 'approve' || mode === 'reject') {
    return <DecisionDialog booking={booking} decision={mode} onClose={app.closeBookingDetails} />
  }

  if (mode === 'approve-series' || mode === 'reject-series') {
    const count = seriesOpenCount
    return (
      <DecisionDialog
        booking={booking}
        decision={mode === 'approve-series' ? 'approve' : 'reject'}
        wholeSeries={{ count }}
        onClose={app.closeBookingDetails}
      />
    )
  }

  if (mode === 'cancel') {
    return <CancelBookingDialog booking={booking} onClose={() => setMode('view')} onCancelled={app.closeBookingDetails} />
  }

  return (
    <Modal
      title={booking.title}
      leading={<RoomDot color={room.color} className="mt-2" />}
      onClose={app.closeBookingDetails}
      footer={
        (canChange || canDecide) && (
          <>
            {canChange && (
              <Button variant="danger" onClick={() => setMode('cancel')} className="mr-auto">
                {booking.status === 'PENDING' ? 'Trekk tilbake' : 'Kanseller'}
              </Button>
            )}
            {canChange && (
              <Button onClick={() => app.openBookingDialog({ bookingId: booking.id })}>
                <Pencil className="size-4" /> Endre
              </Button>
            )}
            {canDecide && (
              <>
                <Button onClick={() => setMode('reject')}>
                  <X className="size-4" /> Avslå
                </Button>
                <Button variant="success" disabled={conflicts.length > 0} onClick={() => setMode('approve')}>
                  <Check className="size-4" /> Godkjenn
                </Button>
              </>
            )}
          </>
        )
      }
    >
      <div className="mb-2">
        <StatusBadge booking={booking} />
      </div>
      <div className="divide-y divide-slate-100">
        <Row icon={<Clock />}>
          <p className="font-medium text-slate-900 first-letter:uppercase">{formatDate(booking.start)}</p>
          <p>{formatTimeRange(booking.start, booking.end)}</p>
        </Row>
        <Row icon={<MapPin />}>
          <p className="font-medium text-slate-900">{room.name}</p>
          {room.room ? (
            (room.room.location || room.room.capacity) && (
              <p className="text-slate-500">
                {[room.room.location, room.room.capacity && `${room.room.capacity} plasser`].filter(Boolean).join(' · ')}
              </p>
            )
          ) : (
            <p className="text-slate-500">Rommet er arkivert og kan ikke bookes lenger.</p>
          )}
        </Row>
        <Row icon={<Building2 />}>{org?.name}</Row>
        {/* The API only names the requester for the own organization and administrators. */}
        {requesterName && (
          <Row icon={<User />}>
            Booket av {requesterName}
            <span className="text-slate-500"> · {formatDateTime(booking.createdAt)}</span>
          </Row>
        )}
        {booking.updatedAt && (
          <Row icon={<Pencil />}>
            Endret{editorName && ` av ${editorName}`}
            <span className="text-slate-500"> · {formatDateTime(booking.updatedAt)}</span>
          </Row>
        )}
        {booking.seriesId && (
          <Row icon={<Repeat />}>
            <SeriesSection
              booking={booking}
              onDecideAll={
                isAdmin
                  ? (decision, count) => {
                      setSeriesOpenCount(count)
                      setMode(decision === 'approve' ? 'approve-series' : 'reject-series')
                    }
                  : undefined
              }
            />
          </Row>
        )}
        {booking.description && (
          <Row icon={<AlignLeft />}>
            <p className="whitespace-pre-line">{booking.description}</p>
          </Row>
        )}
        {booking.decidedAt && (
          <Row icon={<Gavel />}>
            {booking.status === 'REJECTED' ? 'Avslått' : 'Godkjent'} av {deciderName ?? 'administrator'}
            <span className="text-slate-500"> · {formatDateTime(booking.decidedAt)}</span>
            {booking.decisionComment && <p className="mt-1 text-slate-600 italic">«{booking.decisionComment}»</p>}
          </Row>
        )}
        {booking.status === 'CANCELLED' && booking.cancelledAt && (
          <Row icon={<Ban />}>
            {booking.requiresApproval && !booking.decidedAt ? 'Trukket tilbake' : 'Kansellert'}
            {cancellerName && ` av ${cancellerName}`}
            <span className="text-slate-500"> · {formatDateTime(booking.cancelledAt)}</span>
            {booking.cancellationReason && <p className="mt-1 text-slate-600 italic">«{booking.cancellationReason}»</p>}
          </Row>
        )}
      </div>
      <AddToCalendar booking={booking} />
      {booking.status === 'PENDING' &&
        (expired ? (
          <Alert tone="info" className="mt-3">
            Søknaden ble ikke behandlet før tidspunktet, og har utløpt.
          </Alert>
        ) : (
          <Alert tone={conflicts.length && isAdmin ? 'error' : 'info'} className="mt-3">
            {conflicts.length > 0 && isAdmin
              ? `Kan ikke godkjennes: rommet er allerede booket (${conflicts.map((c) => `«${c.title}»`).join(', ')}).`
              : 'Søknaden venter på behandling. Tidsrommet er ikke reservert før søknaden er godkjent.'}
          </Alert>
        ))}
    </Modal>
  )
}

/** The series' occurrences, loaded for the dialog. `key` tells which state of the loaded data they are for. */
interface Occurrences {
  key: string
  bookings?: Booking[]
  error?: string
}

/**
 * "Part of a recurring series": a summary and the expandable list of occurrences. Occurrences are
 * loaded from the API, since the calendar only has the visible range. Administrators can decide
 * every open request in the series at once.
 */
function SeriesSection({
  booking,
  onDecideAll,
}: {
  booking: Booking
  onDecideAll?: (decision: 'approve' | 'reject', openRequests: number) => void
}) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [occurrences, setOccurrences] = useState<Occurrences | null>(null)
  const seriesId = booking.seriesId!
  const { listSeries } = app

  // Reload when an occurrence in the loaded data changes, e.g. after a cancellation or an approval.
  const known = app.data.bookings.filter((b) => b.seriesId === seriesId)
  const key = `${seriesId}|${known.map((b) => `${b.id}:${b.status}:${b.version ?? ''}:${b.start}`).join(',')}`
  useEffect(() => {
    let cancelled = false
    listSeries(key.split('|')[0]).then(
      (bookings) => !cancelled && setOccurrences({ key, bookings }),
      (err: unknown) => !cancelled && setOccurrences({ key, error: errorMessage(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [key, listSeries])

  // Until the first answer, show the occurrences that are already loaded. After a change, the
  // previous answer stays until the new one arrives.
  const list = occurrences?.bookings ?? known
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start))
  const openRequests = sorted.filter((b) => b.status === 'PENDING' && !isExpiredRequest(b)).length
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  return (
    <div>
      <p className="font-medium text-slate-900">Del av en gjentakende serie</p>
      {first && last && (
        <p className="text-slate-500">
          {sorted.length} {sorted.length === 1 ? 'booking' : 'bookinger'} · {formatShortDate(first.start)}–{formatShortDate(last.start)}
        </p>
      )}
      {occurrences?.error && <p className="text-xs text-red-700">Kunne ikke hente serien: {occurrences.error}</p>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        {open ? 'Skjul datoene' : 'Vis alle datoene'}
      </button>
      {open && (
        <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200">
          {sorted.map((b) => {
            const current = b.id === booking.id
            const openable = !current && app.data.bookings.some((d) => d.id === b.id)
            const content = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate first-letter:uppercase">
                    {formatDate(b.start)}
                    {current && <span className="text-slate-500"> (denne)</span>}
                  </span>
                  <span className="block text-xs text-slate-500 tabular-nums">
                    {formatTimeRange(b.start, b.end)}
                    {b.roomId !== booking.roomId && ` · ${app.roomOf(b).name}`}
                  </span>
                </span>
                <StatusBadge booking={b} />
              </>
            )
            return (
              <li key={b.id}>
                {openable ? (
                  <button
                    type="button"
                    onClick={() => app.openBookingDetails(b.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
                  >
                    {content}
                  </button>
                ) : (
                  <div className={cn('flex items-center gap-2 px-3 py-1.5', current && 'bg-slate-50')}>{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {onDecideAll && openRequests > 1 && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecideAll('reject', openRequests)}>
            <X className="size-4" /> Avslå hele serien
          </Button>
          <Button size="sm" variant="success" onClick={() => onDecideAll('approve', openRequests)}>
            <Check className="size-4" /> Godkjenn hele serien ({openRequests})
          </Button>
        </div>
      )}
    </div>
  )
}
