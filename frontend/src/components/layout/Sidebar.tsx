import { CalendarDays, Check, ListChecks, Plus, ShieldCheck, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import { isExpiredRequest } from '../../services/bookingRules'
import { Button } from '../ui/Button'

function NavItem({ to, icon, label, count, onNavigate }: { to: string; icon: ReactNode; label: string; count?: number; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-3 rounded-full px-3 text-sm font-medium transition-colors [&>svg]:size-[18px]',
          isActive ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100',
        )
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {!!count && (
        <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800 tabular-nums">{count}</span>
      )}
    </NavLink>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const app = useApp()
  const { data, currentUser, visibleRoomIds } = app
  const { pathname } = useLocation()

  const open = data.bookings.filter((b) => b.status === 'PENDING' && !isExpiredRequest(b))
  // Booking requests to approve plus new requests from the public form.
  const pendingCount = open.length + (data.newPublicRequests ?? 0)
  const myPendingCount = open.filter((b) => b.requestedById === currentUser.id).length
  const onCalendar = pathname === '/'

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
      <Button
        variant="primary"
        className="h-12 self-start rounded-2xl pr-6 pl-4 shadow-sm"
        onClick={() => {
          app.openBookingDialog()
          onNavigate?.()
        }}
      >
        <Plus className="size-5" /> Ny booking
      </Button>

      <nav aria-label="Hovedmeny" className="space-y-0.5">
        <NavItem to="/" icon={<CalendarDays />} label="Kalender" onNavigate={onNavigate} />
        <NavItem to="/mine-bookinger" icon={<ListChecks />} label="Mine bookinger" count={myPendingCount} onNavigate={onNavigate} />
        {currentUser.role === 'ADMIN' && (
          <NavItem to="/admin" icon={<ShieldCheck />} label="Administrasjon" count={pendingCount} onNavigate={onNavigate} />
        )}
        {(currentUser.orgAdminOrganizationIds?.length ?? 0) > 0 && (
          <NavItem to="/medlemmer" icon={<Users />} label="Medlemmer" onNavigate={onNavigate} />
        )}
      </nav>

      {onCalendar && (
        <section aria-labelledby="room-filter-heading" className="space-y-1">
          <h2 id="room-filter-heading" className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Rom
          </h2>
          {data.rooms.map((room) => {
            const checked = visibleRoomIds.includes(room.id)
            return (
              <label
                key={room.id}
                className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-slate-100"
                title={room.description}
              >
                <input type="checkbox" className="peer sr-only" checked={checked} onChange={() => app.toggleRoom(room.id)} />
                <span
                  aria-hidden
                  className="flex size-[18px] items-center justify-center rounded-[5px] border-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600"
                  style={{ borderColor: room.color, backgroundColor: checked ? room.color : 'transparent' }}
                >
                  {checked && <Check className="size-3 text-white" strokeWidth={3.5} />}
                </span>
                <span className="flex-1 text-sm text-slate-700">
                  {room.name}
                  {room.status === 'DISABLED' && <span className="text-slate-400"> (stengt)</span>}
                </span>
                {room.capacity && <span className="text-xs text-slate-400 tabular-nums">{room.capacity}</span>}
              </label>
            )
          })}

          <div className="mt-3 border-t border-slate-100 pt-3">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-1.5 hover:bg-slate-100">
              <span className="text-sm text-slate-700">Vis ventende søknader</span>
              <input
                type="checkbox"
                role="switch"
                className="peer sr-only"
                checked={app.showPending}
                onChange={(e) => app.setShowPending(e.target.checked)}
              />
              <span
                aria-hidden
                className="relative h-5 w-9 rounded-full bg-slate-300 transition-colors peer-checked:bg-slate-900 peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
              />
            </label>
          </div>

          <div className="space-y-1.5 px-3 pt-3 text-xs text-slate-500">
            <p className="flex items-center gap-2">
              <span className="h-3 w-5 rounded-sm bg-slate-500" /> Bekreftet booking
            </p>
            <p className="flex items-center gap-2">
              <span className="h-3 w-5 rounded-sm border-[1.5px] border-dashed border-slate-500 bg-[repeating-linear-gradient(-45deg,transparent_0_3px,rgb(100_116_139/0.25)_3px_6px)]" />
              Venter på godkjenning
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
