import { Check, ChevronDown, Inbox, Repeat, SearchX, User, UserCheck, X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import { formatDate, formatDateTime, formatShortDate, formatTimeRange } from '../../lib/dates'
import {
  approvalQueue,
  canDecide,
  findConflicts,
  hasRequestFilter,
  matchesRequestFilter,
  NO_REQUEST_FILTER,
  type RequestFilter,
  roomManager,
  VT_MANAGER,
} from '../../services/bookingRules'
import type { Booking } from '../../types'
import { RequestFilters } from '../admin/RequestFilters'
import { Button } from '../ui/Button'
import { Alert } from '../ui/fields'
import { BookingListItem, EmptyState } from './BookingListItem'
import { DecisionDialog } from './DecisionDialog'

/**
 * The approval queue, shared by Administrasjon (system admins, every room) and Til godkjenning
 * (room managers, their rooms): pending requests or the decided ones, with filters. Only requests
 * the user may decide are listed (`canDecide`); the backend only sends those anyway.
 */
export function RequestQueue({
  view,
  filter,
  onFilterChange,
  showManager = false,
}: {
  view: 'pending' | 'processed'
  filter: RequestFilter
  onFilterChange: (filter: RequestFilter) => void
  /** System admins: show and filter by who manages each room ("Forvaltes av"). */
  showManager?: boolean
}) {
  const app = useApp()
  const { pending, processed } = approvalQueue(app.data.bookings, app.currentUser)
  const requests = view === 'pending' ? pending : processed
  const managerOf = (roomId: string) => roomManager(app.data.rooms, roomId)
  const matching = requests.filter((b) => matchesRequestFilter(b, filter, managerOf))
  const noMatches = requests.length > 0 && matching.length === 0
  const rooms = app.data.rooms.filter((r) => canDecide(app.currentUser, { roomId: r.id }))
  const managers = showManager
    ? [
        { id: VT_MANAGER, name: 'VT' },
        ...app.data.organizations
          .filter((o) => app.data.rooms.some((r) => r.managingOrganizationId === o.id))
          .map((o) => ({ id: o.id, name: o.name })),
      ]
    : undefined

  return (
    <>
      {requests.length > 0 && (
        <RequestFilters
          filter={filter}
          onChange={onFilterChange}
          organizations={app.data.organizations}
          rooms={rooms}
          managers={managers}
          shown={matching.length}
          total={requests.length}
        />
      )}
      {noMatches && hasRequestFilter(filter) ? (
        <EmptyState icon={<SearchX />} title="Ingen søknader matcher filtreringen">
          Prøv å fjerne noen av filtrene.
          <div className="mt-3">
            <Button size="sm" onClick={() => onFilterChange(NO_REQUEST_FILTER)}>
              Nullstill filtre
            </Button>
          </div>
        </EmptyState>
      ) : view === 'pending' ? (
        <PendingList bookings={matching} showManager={showManager} />
      ) : (
        <ProcessedList bookings={matching} showManager={showManager} />
      )}
    </>
  )
}

/** Who manages the request's room, for system admins. */
function ManagerLabel({ booking }: { booking: Booking }) {
  const app = useApp()
  const managerId = roomManager(app.data.rooms, booking.roomId)
  return (
    <span className="flex items-center gap-1.5">
      <UserCheck /> Forvaltes av {managerId === VT_MANAGER ? 'VT' : (app.organization(managerId)?.name ?? 'ukjent organisasjon')}
    </span>
  )
}

type Deciding = { booking: Booking; decision: 'approve' | 'reject'; wholeSeries?: { count: number } }

/**
 * Pending requests. Two or more open requests from the same series are shown as one item with
 * the count and date range, which expands to the single occurrences.
 */
function PendingList({ bookings, showManager }: { bookings: Booking[]; showManager: boolean }) {
  const [deciding, setDeciding] = useState<Deciding | null>(null)

  if (bookings.length === 0) {
    return (
      <EmptyState icon={<Inbox />} title="Ingen ventende søknader">
        Nye søknader dukker opp her når organisasjoner uten direkte tilgang ber om et rom.
      </EmptyState>
    )
  }

  // Keep the list sorted by start; a series takes the place of its first open request.
  const groups: Booking[][] = []
  const bySeries = new Map<string, Booking[]>()
  for (const b of bookings) {
    const existing = b.seriesId ? bySeries.get(b.seriesId) : undefined
    if (existing) {
      existing.push(b)
    } else {
      const group = [b]
      groups.push(group)
      if (b.seriesId) bySeries.set(b.seriesId, group)
    }
  }

  return (
    <>
      <ul className="space-y-3">
        {groups.map((group) =>
          group.length > 1 ? (
            <SeriesRequestItem key={group[0].seriesId} bookings={group} onDecide={setDeciding} showManager={showManager} />
          ) : (
            <RequestItem key={group[0].id} booking={group[0]} onDecide={setDeciding} showManager={showManager} />
          ),
        )}
      </ul>
      {deciding && <DecisionDialog {...deciding} onClose={() => setDeciding(null)} />}
    </>
  )
}

function useRequestChecks(b: Booking) {
  const app = useApp()
  const conflicts = findConflicts(app.data.bookings, b.roomId, b.start, b.end, b.id)
  const competing = app.data.bookings.filter(
    (o) => o.id !== b.id && o.status === 'PENDING' && o.roomId === b.roomId && o.start < b.end && b.start < o.end,
  )
  return { conflicts, competing }
}

function RequestItem({ booking: b, onDecide, showManager }: { booking: Booking; onDecide: (d: Deciding) => void; showManager: boolean }) {
  const app = useApp()
  const { conflicts, competing } = useRequestChecks(b)
  return (
    <BookingListItem
      booking={b}
      meta={
        <>
          <span className="flex items-center gap-1.5">
            <User /> {app.user(b.requestedById)?.name ?? b.requestedByName}
          </span>
          {showManager && <ManagerLabel booking={b} />}
        </>
      }
      actions={
        <>
          <Button size="sm" onClick={() => onDecide({ booking: b, decision: 'reject' })}>
            <X className="size-4" /> Avslå
          </Button>
          <Button
            size="sm"
            variant="success"
            disabled={conflicts.length > 0}
            onClick={() => onDecide({ booking: b, decision: 'approve' })}
            title={conflicts.length ? 'Rommet er allerede booket i dette tidsrommet' : undefined}
          >
            <Check className="size-4" /> Godkjenn
          </Button>
        </>
      }
    >
      {b.description && <p className="mt-2 text-sm text-slate-700">{b.description}</p>}
      <p className="mt-2 text-xs text-slate-500">Sendt {formatDateTime(b.createdAt)}</p>
      {conflicts.length > 0 && (
        <Alert tone="error" className="mt-3">
          Kan ikke godkjennes: {app.roomOf(b).name} er allerede booket av{' '}
          {conflicts
            .map((c) => `${app.organization(c.organizationId)?.name} («${c.title}», ${formatTimeRange(c.start, c.end)})`)
            .join(', ')}
          .
        </Alert>
      )}
      {conflicts.length === 0 && competing.length > 0 && (
        <Alert tone="warning" className="mt-3">
          Overlapper med {competing.length === 1 ? 'en annen søknad' : `${competing.length} andre søknader`}:{' '}
          {competing.map((c) => `«${c.title}» (${app.organization(c.organizationId)?.name})`).join(', ')}. Bare én
          kan godkjennes.
        </Alert>
      )}
    </BookingListItem>
  )
}

function SeriesRequestItem({
  bookings,
  onDecide,
  showManager,
}: {
  bookings: Booking[]
  onDecide: (d: Deciding) => void
  showManager: boolean
}) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const first = bookings[0]
  const last = bookings[bookings.length - 1]
  const taken = bookings.filter((b) => findConflicts(app.data.bookings, b.roomId, b.start, b.end, b.id).length > 0)
  const wholeSeries = { count: bookings.length }

  return (
    <BookingListItem
      booking={first}
      hideSeries
      meta={
        <>
          <span className="flex items-center gap-1.5">
            <User /> {app.user(first.requestedById)?.name ?? first.requestedByName}
          </span>
          <span className="flex items-center gap-1.5 font-medium text-slate-700">
            <Repeat /> {bookings.length} søknader · {formatShortDate(first.start)}–{formatShortDate(last.start)}
          </span>
          {showManager && <ManagerLabel booking={first} />}
        </>
      }
      actions={
        <>
          <Button size="sm" onClick={() => onDecide({ booking: first, decision: 'reject', wholeSeries })}>
            <X className="size-4" /> Avslå hele serien
          </Button>
          <Button
            size="sm"
            variant="success"
            disabled={taken.length === bookings.length}
            onClick={() => onDecide({ booking: first, decision: 'approve', wholeSeries })}
          >
            <Check className="size-4" /> Godkjenn hele serien
          </Button>
        </>
      }
    >
      {first.description && <p className="mt-2 text-sm text-slate-700">{first.description}</p>}
      <p className="mt-2 text-xs text-slate-500">Sendt {formatDateTime(first.createdAt)}</p>
      {taken.length > 0 && (
        <Alert tone={taken.length === bookings.length ? 'error' : 'warning'} className="mt-3">
          {taken.length === bookings.length
            ? 'Alle datoene er allerede booket og kan ikke godkjennes.'
            : `${taken.length} av ${bookings.length} datoer er allerede booket. De blir stående som søknader når du godkjenner serien.`}
        </Alert>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        {open ? 'Skjul datoene' : 'Vis datoene og behandle enkeltvis'}
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {bookings.map((b) => {
            const conflict = taken.includes(b)
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <button
                  type="button"
                  onClick={() => app.openBookingDetails(b.id)}
                  className="min-w-0 flex-1 text-left hover:underline"
                >
                  <span className="block truncate text-slate-800 first-letter:uppercase">{formatDate(b.start)}</span>
                  <span className={cn('block text-xs tabular-nums', conflict ? 'text-red-700' : 'text-slate-500')}>
                    {formatTimeRange(b.start, b.end)}
                    {b.roomId !== first.roomId && ` · ${app.roomOf(b).name}`}
                    {conflict && ' · opptatt'}
                  </span>
                </button>
                <Button size="sm" variant="ghost" onClick={() => onDecide({ booking: b, decision: 'reject' })} aria-label={`Avslå ${formatDate(b.start)}`}>
                  <X className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={conflict}
                  onClick={() => onDecide({ booking: b, decision: 'approve' })}
                  aria-label={`Godkjenn ${formatDate(b.start)}`}
                >
                  <Check className="size-4 text-emerald-700" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </BookingListItem>
  )
}

function ProcessedList({ bookings, showManager }: { bookings: Booking[]; showManager: boolean }) {
  const app = useApp()

  if (bookings.length === 0) {
    return <EmptyState icon={<Inbox />} title="Ingen behandlede søknader ennå" />
  }

  return (
    <ul className="space-y-3">
      {bookings.map((b) => (
        <BookingListItem
          key={b.id}
          booking={b}
          meta={
            <>
              <span className="flex items-center gap-1.5">
                <User /> {app.user(b.requestedById)?.name ?? b.requestedByName}
              </span>
              {showManager && <ManagerLabel booking={b} />}
            </>
          }
        >
          <p className="mt-2 text-xs text-slate-500">
            {b.status === 'REJECTED' ? 'Avslått' : 'Godkjent'} av {app.user(b.decidedById ?? '')?.name ?? b.decidedByName ?? 'administrator'}{' '}
            {formatDateTime(b.decidedAt ?? '')}
            {b.status === 'CANCELLED' && ', senere kansellert'}
          </p>
          {b.decisionComment && <p className="mt-1 text-sm text-slate-600 italic">«{b.decisionComment}»</p>}
        </BookingListItem>
      ))}
    </ul>
  )
}
