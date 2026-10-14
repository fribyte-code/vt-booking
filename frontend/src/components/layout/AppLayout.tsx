import { CalendarRange, Menu } from 'lucide-react'
import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { IS_DEMO } from '../../config'
import { useApp } from '../../hooks/useApp'
import { BookingDetailsDialog } from '../booking/BookingDetailsDialog'
import { BookingDialog } from '../booking/BookingDialog'
import { IconButton } from '../ui/Button'
import { Toaster } from '../ui/Toaster'
import { AccountMenu } from './AccountMenu'
import { InvitationBanner } from './InvitationBanner'
import { NotificationsMenu } from './NotificationsMenu'
import { Sidebar } from './Sidebar'
import { UserSwitcher } from './UserSwitcher'

export function AppLayout() {
  const app = useApp()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-slate-200 px-2 sm:px-4">
        <IconButton aria-label="Åpne meny" onClick={() => setDrawerOpen(true)} className="lg:hidden">
          <Menu className="size-5" />
        </IconButton>
        <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 lg:w-[232px]">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <CalendarRange className="size-5" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15px] font-semibold text-slate-900">Rombooking</span>
            <span className="block truncate text-xs text-slate-500">Velferdstinget Vest</span>
          </span>
        </Link>
        <div className="flex-1" />
        {IS_DEMO && (
          <span className="mr-1 hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 ring-inset sm:inline">
            Demo
          </span>
        )}
        <NotificationsMenu />
        {IS_DEMO ? <UserSwitcher /> : <AccountMenu />}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 lg:block">
          <Sidebar />
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} aria-hidden />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
              <Sidebar onNavigate={() => setDrawerOpen(false)} />
            </aside>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <InvitationBanner />
          <div className="min-h-0 flex-1">
            <Outlet />
          </div>
        </main>
      </div>

      {app.bookingDraft && <BookingDialog draft={app.bookingDraft} />}
      {app.detailsBookingId && <BookingDetailsDialog key={app.detailsBookingId} bookingId={app.detailsBookingId} />}
      <Toaster />
    </div>
  )
}
