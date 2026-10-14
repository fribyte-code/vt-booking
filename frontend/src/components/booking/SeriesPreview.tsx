import { CalendarX2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import { formatDate, formatTimeRange } from '../../lib/dates'
import type { TimeSlot } from '../../types'

/** A compact, scrollable list of dates, with taken ones marked. */
export function OccurrenceList({
  items,
  className,
}: {
  items: (TimeSlot & { id?: string; conflict?: boolean; note?: string })[]
  className?: string
}) {
  return (
    <ul className={cn('max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg bg-white ring-1 ring-slate-200', className)}>
      {items.map((o) => (
        <li key={o.id ?? o.start} className={cn('flex items-center gap-2 px-3 py-1.5 text-sm', o.conflict && 'bg-red-50/60')}>
          <span className={cn('min-w-0 flex-1 truncate first-letter:uppercase', o.conflict ? 'text-red-800' : 'text-slate-700')}>
            {formatDate(o.start)}
          </span>
          <span className={cn('shrink-0 tabular-nums', o.conflict ? 'text-red-700' : 'text-slate-500')}>
            {formatTimeRange(o.start, o.end)}
          </span>
          {o.conflict ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-red-700">
              <CalendarX2 className="size-3.5" /> Opptatt
            </span>
          ) : (
            o.note && <span className="shrink-0 text-xs text-slate-500">{o.note}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
