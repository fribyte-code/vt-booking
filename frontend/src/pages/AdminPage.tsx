import { ShieldAlert } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { EmptyState } from '../components/booking/BookingListItem'
import { RequestQueue } from '../components/booking/RequestQueue'
import { Tabs } from '../components/ui/Tabs'
import { useApp } from '../hooks/useApp'
import { approvalQueue, NO_REQUEST_FILTER, type RequestFilter } from '../services/bookingRules'

// Managing users, organizations and rooms, loaded when their tab is opened.
const UsersAdmin = lazy(() => import('../components/admin/UsersAdmin').then((m) => ({ default: m.UsersAdmin })))
const OrganizationsAdmin = lazy(() =>
  import('../components/admin/OrganizationsAdmin').then((m) => ({ default: m.OrganizationsAdmin })),
)
const RoomsAdmin = lazy(() => import('../components/admin/RoomsAdmin').then((m) => ({ default: m.RoomsAdmin })))
const PublicRequestsAdmin = lazy(() =>
  import('../components/admin/PublicRequestsAdmin').then((m) => ({ default: m.PublicRequestsAdmin })),
)
const NightAdmin = lazy(() => import('../components/admin/NightAdmin').then((m) => ({ default: m.NightAdmin })))

type TabId = 'pending' | 'processed' | 'public' | 'night' | 'users' | 'organizations' | 'rooms'

export function AdminPage() {
  const app = useApp()
  const [tab, setTab] = useState<TabId>('pending')
  // One filter for both request lists, so it stays when switching between them.
  const [filter, setFilter] = useState<RequestFilter>(NO_REQUEST_FILTER)

  if (app.currentUser.role !== 'ADMIN') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<ShieldAlert />} title="Ingen tilgang">
          Administrasjonssiden er kun for administratorer.
        </EmptyState>
      </div>
    )
  }

  // Expired requests can no longer be approved, so they are not in the queue.
  const { pending, processed } = approvalQueue(app.data.bookings, app.currentUser)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Administrasjon</h1>
          <p className="mt-1 text-sm text-slate-500">
            Behandle søknader, og administrer brukere, organisasjoner, rom og tilganger.
          </p>
        </div>

        <Tabs<TabId>
          label="Administrasjon"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'pending', label: 'Ventende søknader', count: pending.length, hint: 'Villaorganisasjonene' },
            { id: 'processed', label: 'Behandlet', count: processed.length },
            { id: 'public', label: 'Forespørsler', count: app.data.newPublicRequests || undefined, hint: 'Eksterne, via /soknad' },
            { id: 'night', label: 'Natt', count: app.data.nightWithoutGuards || undefined },
            { id: 'users', label: 'Brukere' },
            { id: 'organizations', label: 'Organisasjoner' },
            { id: 'rooms', label: 'Rom og tilganger' },
          ]}
        />

        <div className="mt-5">
          {(tab === 'pending' || tab === 'processed') && (
            <RequestQueue view={tab} filter={filter} onFilterChange={setFilter} showManager />
          )}
          <Suspense fallback={<p className="text-sm text-slate-500">Laster …</p>}>
            {tab === 'public' && <PublicRequestsAdmin />}
            {tab === 'night' && <NightAdmin />}
            {tab === 'users' && <UsersAdmin />}
            {tab === 'organizations' && <OrganizationsAdmin />}
            {tab === 'rooms' && <RoomsAdmin />}
          </Suspense>
        </div>
      </div>
    </div>
  )
}

