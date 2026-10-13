import type { DatesSetArg } from '@fullcalendar/core'
import type FullCalendar from '@fullcalendar/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { BookingCalendar, type CalendarViewType } from '../components/calendar/BookingCalendar'
import { Button, IconButton } from '../components/ui/Button'
import { useApp } from '../hooks/useApp'
import { cn } from '../lib/cn'
import { formatRangeTitle } from '../lib/dates'

const views: { type: CalendarViewType; label: string }[] = [
  { type: 'timeGridDay', label: 'Dag' },
  { type: 'timeGridWeek', label: 'Uke' },
  { type: 'dayGridMonth', label: 'Måned' },
]

export function CalendarPage() {
  const app = useApp()
  const calendarRef = useRef<FullCalendar>(null)
  const [view, setView] = useState<CalendarViewType>(() =>
    window.matchMedia('(max-width: 639px)').matches ? 'timeGridDay' : 'timeGridWeek',
  )
  const [title, setTitle] = useState('')
  const [showsToday, setShowsToday] = useState(true)

  const api = () => calendarRef.current?.getApi()

  const changeView = (type: CalendarViewType, date?: Date) => {
    api()?.changeView(type, date)
    setView(type)
  }

  const onDatesSet = (arg: DatesSetArg) => {
    setTitle(formatRangeTitle(arg.view.type, arg.view.currentStart, arg.view.currentEnd))
    const now = Date.now()
    setShowsToday(arg.view.currentStart.getTime() <= now && now < arg.view.currentEnd.getTime())
  }

  const bookings = app.data.bookings.filter(
    (b) =>
      app.visibleRoomIds.includes(b.roomId) &&
      (b.status === 'APPROVED' || (b.status === 'PENDING' && app.showPending)),
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-3 sm:px-4">
        <Button size="sm" className="rounded-full px-4" onClick={() => api()?.today()} disabled={showsToday}>
          I dag
        </Button>
        <div className="flex items-center">
          <IconButton aria-label="Forrige" onClick={() => api()?.prev()}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <IconButton aria-label="Neste" onClick={() => api()?.next()}>
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
        <h1 className="order-last min-w-0 basis-full truncate text-lg font-normal text-slate-800 sm:order-none sm:flex-1 sm:basis-auto sm:text-xl">{title}</h1>

        <div role="tablist" aria-label="Visning" className="ml-auto flex rounded-full bg-slate-100 p-0.5 sm:ml-0">
          {views.map((v) => (
            <button
              key={v.type}
              type="button"
              role="tab"
              aria-selected={view === v.type}
              onClick={() => changeView(v.type)}
              className={cn(
                'h-7 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-blue-600',
                view === v.type ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 pr-2 pb-2 sm:pr-4">
        <BookingCalendar
          calendarRef={calendarRef}
          initialView={view}
          bookings={bookings}
          rooms={app.data.rooms}
          organizations={app.data.organizations}
          onSelectRange={(start, end) =>
            app.openBookingDialog({ start: start.toISOString(), end: end.toISOString() })
          }
          onBookingClick={app.openBookingDetails}
          onDatesSet={onDatesSet}
          onDayClick={(date) => changeView('timeGridDay', date)}
        />
      </div>
    </div>
  )
}
