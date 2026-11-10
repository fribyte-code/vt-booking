import { Building2, Clock, Repeat } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../../hooks/useApp'
import { crossesMidnight, formatTimeRange } from '../../lib/dates'
import type { Booking } from '../../types'
import { NightBadge, RoomDot, StatusBadge } from './badges'
import { DateBlock } from './DateBlock'

interface BookingListItemProps {
  booking: Booking
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  /** Leave out "Gjentakende", when `meta` already says how many occurrences the series has. */
  hideSeries?: boolean
}

export function BookingListItem({ booking, meta, actions, children, hideSeries = false }: BookingListItemProps) {
  const app = useApp()
  const room = app.roomOf(booking)

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 transition-shadow hover:shadow-sm sm:flex-row sm:items-start sm:gap-4">
      <div className="flex gap-4 sm:contents">
        <DateBlock date={booking.start} />

        <div className="min-w-0 flex-1 border-l-[3px] pl-4" style={{ borderColor: room.color }}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => app.openBookingDetails(booking.id)}
              className="text-left font-semibold text-slate-900 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              {booking.title}
            </button>
            <StatusBadge booking={booking} />
            {crossesMidnight(booking.start, booking.end) && <NightBadge />}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 [&_svg]:size-3.5 [&_svg]:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Clock /> {formatTimeRange(booking.start, booking.end)}
            </span>
            <span className="flex items-center gap-1.5">
              <RoomDot color={room.color} className="size-2.5" /> {room.name}
            </span>
            {booking.seriesId && !hideSeries && (
              <span className="flex items-center gap-1.5">
                <Repeat /> Gjentakende
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Building2 /> {app.organization(booking.organizationId)?.name}
            </span>
            {meta}
          </div>
          {children}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2 sm:self-center">{actions}</div>}
    </li>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
      <span className="mb-3 text-slate-400 [&>svg]:size-8">{icon}</span>
      <p className="font-medium text-slate-900">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500">{children}</div>}
    </div>
  )
}
