import { Moon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { isExpiredRequest, permissionLabels } from '../../services/bookingRules'
import type { Booking, BookingStatus, Permission } from '../../types'

const statusStyles: Record<BookingStatus, { label: string; className: string }> = {
  APPROVED: { label: 'Bekreftet', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  PENDING: { label: 'Venter på godkjenning', className: 'bg-amber-50 text-amber-800 ring-amber-600/25' },
  REJECTED: { label: 'Avslått', className: 'bg-red-50 text-red-700 ring-red-600/20' },
  CANCELLED: { label: 'Kansellert', className: 'bg-slate-100 text-slate-600 ring-slate-500/20' },
}

const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset'

const expiredStyle = { label: 'Utløpt', className: 'bg-slate-100 text-slate-600 ring-slate-500/20' }

/** The booking's status, with requests that were never decided in time shown as expired. */
export function StatusBadge({ booking }: { booking: Pick<Booking, 'status' | 'start'> }) {
  const { label, className } = isExpiredRequest(booking) ? expiredStyle : statusStyles[booking.status]
  return <span className={cn(pill, className)}>{label}</span>
}

const permissionStyles: Record<Permission, string> = {
  DIRECT: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  REQUEST: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  NONE: 'bg-slate-50 text-slate-500 ring-slate-400/25',
}

const shortLabels: Record<Permission, string> = { DIRECT: 'Direkte', REQUEST: 'Søknad', NONE: 'Ingen' }

export function PermissionBadge({ permission, short }: { permission: Permission; short?: boolean }) {
  return (
    <span className={cn(pill, permissionStyles[permission])}>
      {short ? shortLabels[permission] : permissionLabels[permission]}
    </span>
  )
}

/**
 * Marks a booking that goes past midnight. `onColor` is for the calendar, where it sits on the
 * room color; `compact` keeps it within one line of text; `labelClassName` lets the calendar hide
 * the text when the event is narrow.
 */
export function NightBadge({
  onColor,
  compact,
  labelClassName,
}: {
  onColor?: boolean
  compact?: boolean
  labelClassName?: string
}) {
  return (
    <span
      title="Går over midnatt"
      className={cn(
        pill,
        onColor ? 'bg-white/90 px-1.5 text-orange-700 ring-white/40' : 'bg-orange-50 text-orange-700 ring-orange-600/20',
        compact && 'shrink-0 py-0! leading-4',
      )}
    >
      <Moon className="size-3 shrink-0" aria-hidden />
      <span className={labelClassName}>Nattbooking</span>
    </span>
  )
}

export function RoomDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-3 shrink-0 rounded-[4px]', className)} style={{ backgroundColor: color }} />
}
