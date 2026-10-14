import type { DatesSetArg } from '@fullcalendar/core'
import type FullCalendar from '@fullcalendar/react'
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { BookingCalendar, type BookingMove, type CalendarViewType } from '../components/calendar/BookingCalendar'
import { MoveBookingDialog, type PendingMove } from '../components/calendar/MoveBookingDialog'
import { Button, IconButton } from '../components/ui/Button'
import { useApp } from '../hooks/useApp'
import { cn } from '../lib/cn'
import { formatDate, formatRangeTitle, formatTimeRange } from '../lib/dates'
import { errorMessage } from '../lib/errors'
import { canChangeBooking, evaluateEdit, isExpiredRequest, isOpenForChanges } from '../services/bookingRules'
import type { Booking, UpdateBookingInput } from '../types'

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
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)

  const api = () => calendarRef.current?.getApi()

  const changeView = (type: CalendarViewType, date?: Date) => {
    api()?.changeView(type, date)
    setView(type)
  }

  const onDatesSet = (arg: DatesSetArg) => {
    setTitle(formatRangeTitle(arg.view.type, arg.view.currentStart, arg.view.currentEnd))
    const now = Date.now()
    setShowsToday(arg.view.currentStart.getTime() <= now && now < arg.view.currentEnd.getTime())
    app.setVisibleRange({ start: arg.start.toISOString(), end: arg.end.toISOString() })
  }

  // Stable between renders that don't change them, so the calendar keeps its event store
  // (and a dragged event its new position while a move is being confirmed).
  const { data, visibleRoomIds, showPending, currentUser } = app
  const visibleKey = visibleRoomIds.join(',')
  const bookings = useMemo(() => {
    const visible = new Set(visibleKey.split(','))
    const known = new Set(data.rooms.map((r) => r.id))
    return data.bookings.filter(
      (b) =>
        // Archived rooms have no filter, so their remaining bookings are always shown.
        (visible.has(b.roomId) || !known.has(b.roomId)) &&
        (b.status === 'APPROVED' || (b.status === 'PENDING' && showPending && !isExpiredRequest(b))),
    )
  }, [data, visibleKey, showPending])
  const canMove = useCallback(
    (b: Booking) => canChangeBooking(currentUser, b) && isOpenForChanges(b),
    [currentUser],
  )

  const saveMove = async (booking: Booking, input: UpdateBookingInput, revert: () => void) => {
    try {
      await app.updateBooking(booking, input)
      app.notify(`«${booking.title}» er flyttet til ${formatDate(input.start)} ${formatTimeRange(input.start, input.end)}.`)
    } catch (err) {
      revert()
      app.notify(errorMessage(err), 'error')
    }
  }

  /** A drag or resize. Moves that change the status, or move one occurrence of a series, are confirmed first. */
  const onMove = ({ booking, start, end, revert }: BookingMove) => {
    const input: UpdateBookingInput = {
      roomId: booking.roomId,
      title: booking.title,
      description: booking.description,
      start: start.toISOString(),
      end: end.toISOString(),
    }
    const check = evaluateEdit(app.data, app.currentUser, booking, input)
    if (!check.ok) {
      revert()
      app.notify(check.message, 'error')
    } else if (check.status !== booking.status || booking.seriesId) {
      setPendingMove({ booking, input, check, revert })
    } else {
      void saveMove(booking, input, revert)
    }
  }

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
        <h1 className="order-last min-w-0 basis-full truncate text-lg font-normal text-slate-800 sm:order-none sm:flex-1 sm:basis-auto sm:text-xl">
          {title}
          {app.loading && (
            <LoaderCircle aria-label="Laster" className="ml-2 inline size-4 animate-spin align-middle text-slate-400" />
          )}
        </h1>

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
          canMove={canMove}
          onMove={onMove}
        />
      </div>

      {pendingMove && (
        <MoveBookingDialog
          move={pendingMove}
          onClose={() => {
            pendingMove.revert()
            setPendingMove(null)
          }}
          onConfirm={async () => {
            await saveMove(pendingMove.booking, pendingMove.input, pendingMove.revert)
            setPendingMove(null)
          }}
        />
      )}
    </div>
  )
}
