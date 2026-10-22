import { Check, ChevronDown, Inbox, Repeat, ShieldAlert, User, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Chip } from '../components/admin/Chip'
import { PermissionBadge, RoomDot } from '../components/booking/badges'
import { BookingListItem, EmptyState } from '../components/booking/BookingListItem'
import { DecisionDialog } from '../components/booking/DecisionDialog'
import { Avatar } from '../components/layout/Avatar'
import { Button } from '../components/ui/Button'
import { Alert } from '../components/ui/fields'
import { Tabs } from '../components/ui/Tabs'
import { useApp } from '../hooks/useApp'
import { cn } from '../lib/cn'
import { formatDate, formatDateTime, formatShortDate, formatTimeRange } from '../lib/dates'
import { findConflicts, getPermission, isExpiredRequest } from '../services/bookingRules'
import type { Booking } from '../types'
import { IS_DEMO } from '../config'

// API mode only: managing users, organizations and rooms. The demo shows a read-only overview instead.
const UsersAdmin = lazy(() => import('../components/admin/UsersAdmin').then((m) => ({ default: m.UsersAdmin })))
const OrganizationsAdmin = lazy(() =>
  import('../components/admin/OrganizationsAdmin').then((m) => ({ default: m.OrganizationsAdmin })),
)
const RoomsAdmin = lazy(() => import('../components/admin/RoomsAdmin').then((m) => ({ default: m.RoomsAdmin })))

type TabId = 'pending' | 'processed' | 'access' | 'users' | 'organizations' | 'rooms'

export function AdminPage() {
  const app = useApp()
  const [tab, setTab] = useState<TabId>('pending')

  if (app.currentUser.role !== 'ADMIN') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<ShieldAlert />} title="Ingen tilgang">
          Administrasjonssiden er kun for administratorer.
          {IS_DEMO && ' Bytt til administratorbrukeren øverst til høyre.'}
        </EmptyState>
      </div>
    )
  }

  // Expired requests can no longer be approved, so they are not in the queue.
  const pending = app.data.bookings.filter((b) => b.status === 'PENDING' && !isExpiredRequest(b)).sort((a, b) => a.start.localeCompare(b.start))
  const processed = app.data.bookings
    .filter((b) => b.requiresApproval && b.decidedAt)
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Administrasjon</h1>
          <p className="mt-1 text-sm text-slate-500">
            {IS_DEMO
              ? 'Behandle søknader og se tilganger for rom og organisasjoner.'
              : 'Behandle søknader, og administrer brukere, organisasjoner, rom og tilganger.'}
          </p>
        </div>

        <Tabs<TabId>
          label="Administrasjon"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'pending', label: 'Ventende søknader', count: pending.length },
            { id: 'processed', label: 'Behandlet', count: processed.length },
            ...(IS_DEMO
              ? [{ id: 'access' as const, label: 'Rom og tilganger' }]
              : [
                  { id: 'users' as const, label: 'Brukere' },
                  { id: 'organizations' as const, label: 'Organisasjoner' },
                  { id: 'rooms' as const, label: 'Rom og tilganger' },
                ]),
          ]}
        />

        <div className="mt-5">
          {tab === 'pending' && <PendingList bookings={pending} />}
          {tab === 'processed' && <ProcessedList bookings={processed} />}
          {tab === 'access' && <AccessOverview />}
          {!IS_DEMO && (
            <Suspense fallback={<p className="text-sm text-slate-500">Laster …</p>}>
              {tab === 'users' && <UsersAdmin />}
              {tab === 'organizations' && <OrganizationsAdmin />}
              {tab === 'rooms' && <RoomsAdmin />}
            </Suspense>
          )}
        </div>
      </div>
    </div>
  )
}

type Deciding = { booking: Booking; decision: 'approve' | 'reject'; wholeSeries?: { count: number } }

/**
 * Pending requests. Two or more open requests from the same series are shown as one item with
 * the count and date range, which expands to the single occurrences.
 */
function PendingList({ bookings }: { bookings: Booking[] }) {
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
            <SeriesRequestItem key={group[0].seriesId} bookings={group} onDecide={setDeciding} />
          ) : (
            <RequestItem key={group[0].id} booking={group[0]} onDecide={setDeciding} />
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

function RequestItem({ booking: b, onDecide }: { booking: Booking; onDecide: (d: Deciding) => void }) {
  const app = useApp()
  const { conflicts, competing } = useRequestChecks(b)
  return (
    <BookingListItem
      booking={b}
      meta={
        <span className="flex items-center gap-1.5">
          <User /> {app.user(b.requestedById)?.name ?? b.requestedByName}
        </span>
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

function SeriesRequestItem({ bookings, onDecide }: { bookings: Booking[]; onDecide: (d: Deciding) => void }) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const first = bookings[0]
  const last = bookings[bookings.length - 1]
  const taken = bookings.filter((b) => findConflicts(app.data.bookings, b.roomId, b.start, b.end, b.id).length > 0)
  const wholeSeries = { count: bookings.length }

  return (
    <BookingListItem
      booking={first}
      meta={
        <>
          <span className="flex items-center gap-1.5">
            <User /> {app.user(first.requestedById)?.name ?? first.requestedByName}
          </span>
          <span className="flex items-center gap-1.5 font-medium text-slate-700">
            <Repeat /> {bookings.length} søknader · {formatShortDate(first.start)}–{formatShortDate(last.start)}
          </span>
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

function ProcessedList({ bookings }: { bookings: Booking[] }) {
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

function AccessOverview() {
  const { data } = useApp()

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-base font-semibold text-slate-900">Bookingtilganger</h2>
        <p className="mb-4 text-sm text-slate-500">
          Hvilke organisasjoner som kan booke hvert rom direkte, må søke, eller ikke har tilgang. Redigering av
          tilganger er ikke med i prototypen.
        </p>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Rom
                </th>
                {data.organizations.map((o) => (
                  <th key={o.id} scope="col" className="px-4 py-3">
                    {o.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rooms.map((room) => (
                <tr key={room.id}>
                  <th scope="row" className="px-4 py-3 font-normal">
                    <span className="flex items-center gap-2.5">
                      <RoomDot color={room.color} />
                      <span>
                        <span className="block font-medium text-slate-900">{room.name}</span>
                        <span className="block text-xs text-slate-500">
                          {[room.capacity && `${room.capacity} plasser`, room.location].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </span>
                  </th>
                  {data.organizations.map((o) => (
                    <td key={o.id} className="px-4 py-3">
                      <PermissionBadge permission={getPermission(room, o.id)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-base font-semibold text-slate-900">Brukere</h2>
        <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
          {data.users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar user={u} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{u.name}</p>
                <p className="truncate text-xs text-slate-500">{u.email}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {u.role === 'ADMIN' ? (
                  <Chip label="Administrator" />
                ) : (
                  u.organizationIds.map((id) => (
                    <Chip key={id} label={data.organizations.find((o) => o.id === id)?.name ?? id} />
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
