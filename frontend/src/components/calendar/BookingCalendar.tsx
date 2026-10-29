import type {
  DateSelectArg,
  DatesSetArg,
  DayHeaderContentArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventMountArg,
} from '@fullcalendar/core'
import nbLocale from '@fullcalendar/core/locales/nb'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { Hourglass, Repeat } from 'lucide-react'
import { type Ref, useMemo } from 'react'
import { cn } from '../../lib/cn'
import { tint } from '../../lib/color'
import { roomInfo } from '../../lib/rooms'
import type { Booking, Organization, Room } from '../../types'

export type CalendarViewType = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth'

interface EventProps {
  booking: Booking
  roomName: string
  color: string
  organization?: Organization
}

/** A booking dragged or resized to a new time. Call `revert` to put it back if the move is not saved. */
export interface BookingMove {
  booking: Booking
  start: Date
  end: Date
  revert: () => void
}

interface BookingCalendarProps {
  calendarRef: Ref<FullCalendar>
  initialView: CalendarViewType
  bookings: Booking[]
  rooms: Room[]
  organizations: Organization[]
  onSelectRange: (start: Date, end: Date) => void
  onBookingClick: (id: string) => void
  onDatesSet: (arg: DatesSetArg) => void
  onDayClick: (date: Date) => void
  /** Whether the user may drag and resize this booking. */
  canMove: (booking: Booking) => boolean
  onMove: (move: BookingMove) => void
}

const plugins = [timeGridPlugin, dayGridPlugin, interactionPlugin]
const timeFormat = { hour: '2-digit', minute: '2-digit', hour12: false } as const
const eventTimeFormat = { ...timeFormat, separator: '–' } as const

export function BookingCalendar({
  calendarRef,
  initialView,
  bookings,
  rooms,
  organizations,
  onSelectRange,
  onBookingClick,
  onDatesSet,
  onDayClick,
  canMove,
  onMove,
}: BookingCalendarProps) {
  // Memoized: FullCalendar compares the events option by identity, and a new array on every
  // render would reset an event that is being dragged while the move is confirmed.
  const events: EventInput[] = useMemo(() => bookings.map((booking) => {
    // Bookings in archived rooms are kept, with the room name from the booking and a neutral color.
    const { name, color, room } = roomInfo(rooms.find((r) => r.id === booking.roomId), booking)
    const pending = booking.status === 'PENDING'
    const props: EventProps = {
      booking,
      roomName: name,
      color,
      organization: organizations.find((o) => o.id === booking.organizationId),
    }
    return {
      id: booking.id,
      title: booking.title,
      start: booking.start,
      end: booking.end,
      // Bookings in archived rooms can't be moved, only renamed or cancelled.
      editable: !!room && canMove(booking),
      backgroundColor: pending ? tint(color, 0.1) : color,
      borderColor: color,
      textColor: pending ? color : '#fff',
      classNames: pending ? ['ev-pending'] : [],
      extendedProps: props,
    }
  }), [bookings, rooms, organizations, canMove])

  const handleMove = (info: EventDropArg | EventResizeDoneArg) => {
    const { booking } = info.event.extendedProps as EventProps
    if (!info.event.start || !info.event.end) {
      info.revert()
      return
    }
    onMove({ booking, start: info.event.start, end: info.event.end, revert: info.revert })
  }

  const handleSelect = (info: DateSelectArg) => {
    let start = info.start
    let end = info.end
    if (info.allDay) {
      // Month view selects whole days; suggest a one-hour slot on the first day.
      start = new Date(info.start)
      start.setHours(9, 0, 0, 0)
      end = new Date(start.getTime() + 3_600_000)
    } else if (end.getTime() - start.getTime() < 30 * 60_000) {
      // A single click selects one snap interval; default to one hour like Google Calendar.
      end = new Date(start.getTime() + 3_600_000)
    }
    info.view.calendar.unselect()
    onSelectRange(start, end)
  }

  return (
    <FullCalendar
      ref={calendarRef}
      plugins={plugins}
      initialView={initialView}
      locale={nbLocale}
      headerToolbar={false}
      height="100%"
      firstDay={1}
      nowIndicator
      selectable
      selectMirror
      allDaySlot={false}
      slotMinTime="06:00:00"
      slotMaxTime="24:00:00"
      scrollTime="07:30:00"
      slotDuration="00:30:00"
      snapDuration="00:15:00"
      slotLabelInterval="01:00"
      slotLabelFormat={timeFormat}
      eventTimeFormat={eventTimeFormat}
      eventDisplay="block"
      dayMaxEvents={3}
      expandRows
      navLinks
      navLinkDayClick={onDayClick}
      events={events}
      select={handleSelect}
      eventClick={(arg: EventClickArg) => {
        arg.jsEvent.preventDefault()
        onBookingClick(arg.event.id)
      }}
      eventDrop={handleMove}
      eventResize={handleMove}
      eventDidMount={(arg: EventMountArg) => {
        const { color } = arg.event.extendedProps as Partial<EventProps>
        if (color) arg.el.style.setProperty('--room-color', color)
      }}
      datesSet={onDatesSet}
      dayHeaderContent={renderDayHeader}
      dayCellContent={(arg) => arg.date.getDate()}
      eventContent={renderEvent}
    />
  )
}

function renderDayHeader(arg: DayHeaderContentArg) {
  const weekday = arg.date.toLocaleDateString('nb-NO', { weekday: 'short' }).replace('.', '')
  if (arg.view.type === 'dayGridMonth') {
    return <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{weekday}</span>
  }
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span
        className={cn(
          'text-[11px] font-semibold tracking-wide uppercase',
          arg.isToday ? 'text-blue-700' : 'text-slate-500',
        )}
      >
        {weekday}
      </span>
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-full text-xl transition-colors',
          arg.isToday ? 'bg-blue-600 font-medium text-white' : 'text-slate-800 hover:bg-slate-100',
        )}
      >
        {arg.date.getDate()}
      </span>
    </span>
  )
}

function renderEvent(arg: EventContentArg) {
  const { booking, roomName, organization } = arg.event.extendedProps as Partial<EventProps>
  // The placeholder FullCalendar draws for a time being selected has no booking. Throwing here
  // breaks the calendar's rendering, so later changes stop showing until the page is reloaded.
  if (!booking) return <span className="text-xs">{arg.timeText}</span>
  const pending = booking.status === 'PENDING'
  const label = `${booking.title}, ${arg.timeText}, ${roomName}${pending ? ', venter på godkjenning' : ''}${booking.seriesId ? ', gjentakende' : ''}`

  if (arg.view.type === 'dayGridMonth') {
    return (
      <span className="flex min-w-0 items-center gap-1 text-xs" aria-label={label}>
        {pending && <Hourglass className="size-3 shrink-0" />}
        {booking.seriesId && <Repeat className="size-3 shrink-0" />}
        <span className="shrink-0 opacity-90">{arg.timeText}</span>
        <span className="truncate font-medium">{booking.title}</span>
      </span>
    )
  }

  return (
    <span className="flex h-full min-w-0 flex-col overflow-hidden text-xs leading-snug" aria-label={label}>
      <span className="flex items-center gap-1 font-semibold">
        {pending && <Hourglass className="size-3 shrink-0" />}
        <span className="truncate">{booking.title}</span>
        {booking.seriesId && <Repeat className="size-3 shrink-0 opacity-80" />}
      </span>
      <span className="truncate opacity-90">{arg.timeText}</span>
      <span className="truncate opacity-85">
        {roomName}
        {organization && ` · ${organization.name}`}
      </span>
    </span>
  )
}
