import { CalendarX2, Plus } from 'lucide-react'
import { useState } from 'react'
import { BookingListItem, EmptyState } from '../components/booking/BookingListItem'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Tabs } from '../components/ui/Tabs'
import { useApp } from '../hooks/useApp'
import { formatDate, formatTimeRange, isFuture } from '../lib/dates'
import { errorMessage } from '../lib/errors'
import type { Booking } from '../types'

type TabId = 'upcoming' | 'pending' | 'rejected' | 'past'

const emptyText: Record<TabId, string> = {
  upcoming: 'Du har ingen kommende bookinger.',
  pending: 'Du har ingen søknader som venter på behandling.',
  rejected: 'Du har ingen avslåtte søknader.',
  past: 'Ingen tidligere eller kansellerte bookinger.',
}

export function MyBookingsPage() {
  const app = useApp()
  const [tab, setTab] = useState<TabId>('upcoming')
  const [cancelling, setCancelling] = useState<Booking | null>(null)

  const mine = app.data.bookings.filter((b) => b.requestedById === app.currentUser.id)
  const byStart = (a: Booking, b: Booking) => a.start.localeCompare(b.start)
  const groups: Record<TabId, Booking[]> = {
    upcoming: mine.filter((b) => b.status === 'APPROVED' && isFuture(b.end)).sort(byStart),
    pending: mine.filter((b) => b.status === 'PENDING').sort(byStart),
    rejected: mine.filter((b) => b.status === 'REJECTED').sort(byStart),
    past: mine
      .filter((b) => b.status === 'CANCELLED' || (b.status === 'APPROVED' && !isFuture(b.end)))
      .sort((a, b) => byStart(b, a)),
  }

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
          {groups[tab].length === 0 ? (
            <EmptyState icon={<CalendarX2 />} title={emptyText[tab]}>
              {tab === 'upcoming' && 'Velg et tidsrom i kalenderen eller trykk «Ny booking» for å booke et rom.'}
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {groups[tab].map((b) => {
                const cancellable = (b.status === 'APPROVED' || b.status === 'PENDING') && isFuture(b.start)
                return (
                  <BookingListItem
                    key={b.id}
                    booking={b}
                    actions={
                      cancellable && (
                        <Button size="sm" variant="danger" onClick={() => setCancelling(b)}>
                          {b.status === 'PENDING' ? 'Trekk tilbake' : 'Kanseller'}
                        </Button>
                      )
                    }
                  >
                    {b.status === 'REJECTED' && b.decisionComment && (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                        Begrunnelse: {b.decisionComment}
                      </p>
                    )}
                    {b.status === 'PENDING' && (
                      <p className="mt-2 text-xs text-slate-500">
                        Tidsrommet er ikke reservert før søknaden er godkjent.
                      </p>
                    )}
                  </BookingListItem>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {cancelling && (
        <ConfirmDialog
          title={cancelling.status === 'PENDING' ? 'Trekk tilbake søknad?' : 'Kanseller booking?'}
          confirmLabel={cancelling.status === 'PENDING' ? 'Trekk tilbake' : 'Kanseller'}
          destructive
          onClose={() => setCancelling(null)}
          onConfirm={async () => {
            try {
              await app.cancelBooking(cancelling.id)
              app.notify(`«${cancelling.title}» er kansellert.`, 'info')
            } catch (err) {
              app.notify(errorMessage(err), 'error')
            }
            setCancelling(null)
          }}
        >
          «{cancelling.title}» i {app.room(cancelling.roomId)?.name}, {formatDate(cancelling.start)}{' '}
          {formatTimeRange(cancelling.start, cancelling.end)}.
        </ConfirmDialog>
      )}
    </div>
  )
}
