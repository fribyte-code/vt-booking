import { CalendarX2, Pencil, Plus, SearchX } from 'lucide-react'
import { useState } from 'react'
import { RequestFilters } from '../components/admin/RequestFilters'
import { BookingListItem, EmptyState } from '../components/booking/BookingListItem'
import { CancelBookingDialog } from '../components/booking/CancelBookingDialog'
import { Button } from '../components/ui/Button'
import { Tabs } from '../components/ui/Tabs'
import { useApp } from '../hooks/useApp'
import { isFuture } from '../lib/dates'
import {
  canChangeBooking,
  hasRequestFilter,
  isExpiredRequest,
  isOpenForChanges,
  matchesRequestFilter,
  NO_REQUEST_FILTER,
  type RequestFilter,
} from '../services/bookingRules'
import type { Booking } from '../types'

type TabId = 'upcoming' | 'pending' | 'rejected' | 'past'

const emptyText: Record<TabId, string> = {
  upcoming: 'Du har ingen kommende bookinger.',
  pending: 'Du har ingen søknader som venter på behandling.',
  rejected: 'Du har ingen avslåtte søknader.',
  past: 'Ingen tidligere, kansellerte eller utløpte bookinger.',
}

export function MyBookingsPage() {
  const app = useApp()
  const [tab, setTab] = useState<TabId>('upcoming')
  const [cancelling, setCancelling] = useState<Booking | null>(null)
  // One filter for all the tabs, so it stays when switching between them.
  const [filter, setFilter] = useState<RequestFilter>(NO_REQUEST_FILTER)

  const mine = app.data.bookings.filter((b) => b.requestedById === app.currentUser.id)
  const byStart = (a: Booking, b: Booking) => a.start.localeCompare(b.start)
  const groups: Record<TabId, Booking[]> = {
    upcoming: mine.filter((b) => b.status === 'APPROVED' && isFuture(b.end)).sort(byStart),
    pending: mine.filter((b) => b.status === 'PENDING' && !isExpiredRequest(b)).sort(byStart),
    rejected: mine.filter((b) => b.status === 'REJECTED').sort(byStart),
    past: mine
      .filter(
        (b) => b.status === 'CANCELLED' || isExpiredRequest(b) || (b.status === 'APPROVED' && !isFuture(b.end)),
      )
      .sort((a, b) => byStart(b, a)),
  }

  const shown = groups[tab].filter((b) => matchesRequestFilter(b, filter))
  const noMatches = groups[tab].length > 0 && shown.length === 0
  const myOrganizations = app.data.organizations.filter((o) => app.currentUser.organizationIds.includes(o.id))

  const orgNames = app.currentUser.organizationIds.map((id) => app.organization(id)?.name).join(', ')

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Mine bookinger</h1>
            <p className="mt-1 text-sm text-slate-500">
              {app.currentUser.name}
              {orgNames && ` · ${orgNames}`}
            </p>
          </div>
          <Button variant="primary" onClick={() => app.openBookingDialog()}>
            <Plus className="size-4" /> Ny booking
          </Button>
        </div>

        <Tabs<TabId>
          label="Filtrer bookinger"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'upcoming', label: 'Kommende', count: groups.upcoming.length },
            { id: 'pending', label: 'Venter på svar', count: groups.pending.length },
            { id: 'rejected', label: 'Avslått', count: groups.rejected.length },
            { id: 'past', label: 'Tidligere', count: groups.past.length },
          ]}
        />

        <div className="mt-5">
          {groups[tab].length > 0 && (
            <RequestFilters
              filter={filter}
              onChange={setFilter}
              organizations={myOrganizations}
              rooms={app.data.rooms}
              shown={shown.length}
              total={groups[tab].length}
              noun={{ one: 'booking', many: 'bookinger' }}
            />
          )}
          {noMatches && hasRequestFilter(filter) ? (
            <EmptyState icon={<SearchX />} title="Ingen bookinger matcher filtreringen">
              Prøv å fjerne noen av filtrene.
              <div className="mt-3">
                <Button size="sm" onClick={() => setFilter(NO_REQUEST_FILTER)}>
                  Nullstill filtre
                </Button>
              </div>
            </EmptyState>
          ) : groups[tab].length === 0 ? (
            <EmptyState icon={<CalendarX2 />} title={emptyText[tab]}>
              {tab === 'upcoming' && 'Velg et tidsrom i kalenderen eller trykk «Ny booking» for å booke et rom.'}
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {shown.map((b) => {
                const changeable = canChangeBooking(app.currentUser, b) && isOpenForChanges(b)
                return (
                  <BookingListItem
                    key={b.id}
                    booking={b}
                    actions={
                      changeable && (
                        <>
                          <Button size="sm" onClick={() => app.openBookingDialog({ bookingId: b.id })}>
                            <Pencil className="size-4" /> Endre
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setCancelling(b)}>
                            {b.status === 'PENDING' ? 'Trekk tilbake' : 'Kanseller'}
                          </Button>
                        </>
                      )
                    }
                  >
                    {b.status === 'REJECTED' && b.decisionComment && (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                        Begrunnelse: {b.decisionComment}
                      </p>
                    )}
                    {b.status === 'APPROVED' && b.decisionComment && (
                      <p className="mt-2 text-sm text-slate-600">Kommentar fra administrator: {b.decisionComment}</p>
                    )}
                    {b.status === 'CANCELLED' && b.cancelledById && b.cancelledById !== b.requestedById && (
                      <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
                        Kansellert av {b.cancelledByName ?? app.user(b.cancelledById)?.name ?? 'en administrator'}
                        {b.cancellationReason && `: ${b.cancellationReason}`}
                      </p>
                    )}
                    {b.status === 'PENDING' && (
                      <p className="mt-2 text-xs text-slate-500">
                        {isExpiredRequest(b)
                          ? 'Søknaden ble ikke behandlet før tidspunktet, og har utløpt.'
                          : 'Tidsrommet er ikke reservert før søknaden er godkjent.'}
                      </p>
                    )}
                  </BookingListItem>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {cancelling && <CancelBookingDialog booking={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  )
}
