import { cn } from '../../lib/cn'
import { permissionLabels } from '../../services/bookingRules'
import type { BookingStatus, Permission } from '../../types'

const statusStyles: Record<BookingStatus, { label: string; className: string }> = {
  APPROVED: { label: 'Bekreftet', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  PENDING: { label: 'Venter på godkjenning', className: 'bg-amber-50 text-amber-800 ring-amber-600/25' },
  REJECTED: { label: 'Avslått', className: 'bg-red-50 text-red-700 ring-red-600/20' },
  CANCELLED: { label: 'Kansellert', className: 'bg-slate-100 text-slate-600 ring-slate-500/20' },
}

const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset'

export function StatusBadge({ status }: { status: BookingStatus }) {
  const { label, className } = statusStyles[status]
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

export function RoomDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-3 shrink-0 rounded-[4px]', className)} style={{ backgroundColor: color }} />
}
