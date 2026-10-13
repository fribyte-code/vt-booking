import { Check, Inbox, ShieldAlert, User, X } from 'lucide-react'
import { useState } from 'react'
import { PermissionBadge, RoomDot } from '../components/booking/badges'
import { BookingListItem, EmptyState } from '../components/booking/BookingListItem'
import { RejectDialog } from '../components/booking/RejectDialog'
import { Avatar } from '../components/layout/Avatar'
import { Button } from '../components/ui/Button'
import { Alert } from '../components/ui/fields'
import { Tabs } from '../components/ui/Tabs'
import { useApp } from '../hooks/useApp'
import { useApprove } from '../hooks/useApprove'
import { formatDateTime, formatTimeRange } from '../lib/dates'
import { findConflicts, getPermission } from '../services/bookingRules'
import type { Booking } from '../types'

type TabId = 'pending' | 'processed' | 'access'

export function AdminPage() {
  const app = useApp()
  const [tab, setTab] = useState<TabId>('pending')

  if (app.currentUser.role !== 'ADMIN') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<ShieldAlert />} title="Ingen tilgang">
          Administrasjonssiden er kun for administratorer. Bytt til administratorbrukeren øverst til høyre.
        </EmptyState>
      </div>
    )
  }

  const pending = app.data.bookings.filter((b) => b.status === 'PENDING').sort((a, b) => a.start.localeCompare(b.start))
  const processed = app.data.bookings
    .filter((b) => b.requiresApproval && b.decidedAt)
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Administrasjon</h1>
          <p className="mt-1 text-sm text-slate-500">Behandle søknader og se tilganger for rom og organisasjoner.</p>
        </div>

        <Tabs<TabId>
          label="Administrasjon"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'pending', label: 'Ventende søknader', count: pending.length },
            { id: 'processed', label: 'Behandlet', count: processed.length },
            { id: 'access', label: 'Rom og tilganger' },
          ]}
        />

        <div className="mt-5">
          {tab === 'pending' && <PendingList bookings={pending} />}
          {tab === 'processed' && <ProcessedList bookings={processed} />}
          {tab === 'access' && <AccessOverview />}
        </div>
      </div>
    </div>
  )
}

function PendingList({ bookings }: { bookings: Booking[] }) {
  const app = useApp()
  const { approve, busyId } = useApprove()
  const [rejecting, setRejecting] = useState<Booking | null>(null)

  if (bookings.length === 0) {
    return (
      <EmptyState icon={<Inbox />} title="Ingen ventende søknader">
        Nye søknader dukker opp her når organisasjoner uten direkte tilgang ber om et rom.
      </EmptyState>
    )
  }

  return (
    <>
      <ul className="space-y-3">
        {bookings.map((b) => {
          const conflicts = findConflicts(app.data.bookings, b.roomId, b.start, b.end, b.id)
          const competing = app.data.bookings.filter(
            (o) =>
              o.id !== b.id &&
              o.status === 'PENDING' &&
              o.roomId === b.roomId &&
              o.start < b.end &&
              b.start < o.end,
          )
          return (
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
              actions={
                <>
                  <Button size="sm" onClick={() => setRejecting(b)}>
                    <X className="size-4" /> Avslå
                  </Button>
                  <Button
                    size="sm"
                    variant="success"
                    disabled={conflicts.length > 0 || busyId === b.id}
                    onClick={() => approve(b)}
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
                  Kan ikke godkjennes: {app.room(b.roomId)?.name} er allerede booket av{' '}
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
        })}
      </ul>
      {rejecting && <RejectDialog booking={rejecting} onClose={() => setRejecting(null)} />}
    </>
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
                          {room.capacity} plasser · {room.location}
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

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-slate-700">{label}</span>
  )
}
