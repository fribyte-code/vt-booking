import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../components/booking/BookingListItem'
import { RequestQueue } from '../components/booking/RequestQueue'
import { Tabs } from '../components/ui/Tabs'
import { useApp } from '../hooks/useApp'
import { approvalQueue, NO_REQUEST_FILTER, type RequestFilter } from '../services/bookingRules'

type TabId = 'pending' | 'processed'

/**
 * Til godkjenning: room managers (ORG_ADMINs of the organization managing a room) approve and
 * reject the requests for their rooms. The backend only sends those, and checks every decision.
 */
export function ApprovalsPage() {
  const app = useApp()
  const [tab, setTab] = useState<TabId>('pending')
  const [filter, setFilter] = useState<RequestFilter>(NO_REQUEST_FILTER)
  const managed = app.currentUser.managedRoomIds ?? []

  if (managed.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<ShieldAlert />} title="Ingen rom å godkjenne for">
          Siden er for organisasjonsadministratorer i organisasjoner som forvalter et rom.
        </EmptyState>
      </div>
    )
  }

  const { pending, processed } = approvalQueue(app.data.bookings, app.currentUser)
  const roomNames = app.data.rooms
    .filter((r) => managed.includes(r.id))
    .map((r) => r.name)
    .join(', ')

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Til godkjenning</h1>
          <p className="mt-1 text-sm text-slate-500">
            Søknader om rom organisasjonen din forvalter{roomNames ? `: ${roomNames}` : ''}. Du godkjenner eller avslår på
            vegne av VT.
          </p>
        </div>
        <Tabs<TabId>
          label="Til godkjenning"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'pending', label: 'Ventende søknader', count: pending.length },
            { id: 'processed', label: 'Behandlet', count: processed.length },
          ]}
        />
        <div className="mt-5">
          <RequestQueue view={tab} filter={filter} onFilterChange={setFilter} />
        </div>
      </div>
    </div>
  )
}
