import { Hourglass, Repeat } from 'lucide-react'
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { tint } from '../../lib/color'
import { crossesMidnight, formatTimeRange } from '../../lib/dates'
import { roomInfo } from '../../lib/rooms'
import type { Booking, Organization, Room } from '../../types'
import { NightBadge } from '../booking/badges'

/** Hours shown when the day has nothing outside them; the range grows to fit earlier or later bookings. */
const DEFAULT_START_HOUR = 8
const DEFAULT_END_HOUR = 22
const HOUR_WIDTH = 72
const LANE_HEIGHT = 48
const TRACK_PADDING = 6
/** A click on a free spot starts the booking at the half hour before it, like the other calendar. */
const SNAP_MINUTES = 30

interface DailyRoomCalendarProps {
  day: Date
  onDayChange: (day: Date) => void
  /** The rooms to show, one row each. */
  rooms: Room[]
  /** The bookings to show. Bookings in rooms that are not in `rooms` (archived) get a row of their own. */
  bookings: Booking[]
  organizations: Organization[]
  onSelectRange: (start: Date, end: Date, roomId: string) => void
  onBookingClick: (id: string) => void
}

interface Row {
  id: string
  name: string
  color: string
  capacity?: number
  closed: boolean
  /** Archived rooms can't be booked, so their free time isn't clickable. */
  bookable: boolean
  items: Placed[]
  lanes: number
}

interface Placed {
  booking: Booking
  startMin: number
  endMin: number
  lane: number
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Minutes after local midnight of `dayStart`, clamped to the day for bookings that cross midnight. */
function minutesIntoDay(date: Date, dayStart: Date): number {
  const next = addDays(dayStart, 1)
  if (date <= dayStart) return 0
  if (date >= next) return 24 * 60
  return date.getHours() * 60 + date.getMinutes()
}

/** Puts overlapping bookings (pending requests may overlap) on separate lines in the row. */
function placeInLanes(items: Omit<Placed, 'lane'>[]): { placed: Placed[]; lanes: number } {
  const laneEnds: number[] = []
  const placed = [...items]
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
    .map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.startMin)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = item.endMin
      return { ...item, lane }
    })
  return { placed, lanes: Math.max(1, laneEnds.length) }
}

export function DailyRoomCalendar({
  day,
  onDayChange,
  rooms,
  bookings,
  organizations,
  onSelectRange,
  onBookingClick,
}: DailyRoomCalendarProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const dayKey = startOfDay(day).getTime()
  const dayStart = new Date(dayKey)

  const { rows, startHour, endHour } = (() => {
    const start = new Date(dayKey)
    const next = addDays(start, 1)
    const today = bookings
      .filter((b) => new Date(b.start) < next && new Date(b.end) > start)
      .map((booking) => ({
        booking,
        startMin: minutesIntoDay(new Date(booking.start), start),
        endMin: minutesIntoDay(new Date(booking.end), start),
      }))

    let first = DEFAULT_START_HOUR
    let last = DEFAULT_END_HOUR
    for (const t of today) {
      first = Math.min(first, Math.floor(t.startMin / 60))
      last = Math.max(last, Math.ceil(t.endMin / 60))
    }

    const build = (id: string, base: Omit<Row, 'id' | 'items' | 'lanes'>): Row => {
      const { placed, lanes } = placeInLanes(today.filter((t) => t.booking.roomId === id))
      return { id, ...base, items: placed, lanes }
    }
    const known = new Set(rooms.map((r) => r.id))
    const result = rooms.map((room) =>
      build(room.id, {
        name: room.name,
        color: room.color,
        capacity: room.capacity,
        closed: room.status === 'DISABLED',
        bookable: true,
      }),
    )
    // Archived rooms have no filter entry, but their bookings still show, as in the other calendar.
    const archived = new Map<string, Booking>()
    for (const t of today) if (!known.has(t.booking.roomId)) archived.set(t.booking.roomId, t.booking)
    for (const [id, booking] of archived) {
      const { name, color } = roomInfo(undefined, booking)
      result.push(build(id, { name, color, closed: false, bookable: false }))
    }
    return { rows: result, startHour: first, endHour: last }
  })()

  const hours = endHour - startHour
  const rangeMinutes = hours * 60
  const pct = (minutes: number) => ((minutes - startHour * 60) / rangeMinutes) * 100

  const todayStart = startOfDay(new Date(now))
  const isToday = dayKey === todayStart.getTime()
  const isPastDay = dayKey < todayStart.getTime()
  const nowDate = new Date(now)
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
  const nowPct = isToday ? pct(nowMinutes) : -1
  const pastPct = isPastDay ? 100 : isToday ? Math.min(100, Math.max(0, pct(nowMinutes))) : 0

  // Bring the current time (today) or the start of the range into view when the day changes.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const n = new Date()
    const same = startOfDay(n).getTime() === dayKey
    const minutes = n.getHours() * 60 + n.getMinutes()
    const inRange = minutes >= startHour * 60 && minutes <= endHour * 60
    el.scrollLeft = same && inRange ? Math.max(0, ((minutes - startHour * 60) / rangeMinutes) * el.scrollWidth - 160) : 0
    // Only when the day changes; later reloads of the same day shouldn't move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey])

  const clickFreeTime = (e: MouseEvent<HTMLDivElement>, roomId: string) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const minutes = startHour * 60 + Math.floor((fraction * rangeMinutes) / SNAP_MINUTES) * SNAP_MINUTES
    const start = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, minutes)
    onSelectRange(start, new Date(start.getTime() + 3_600_000), roomId)
  }

  const hourLines = `linear-gradient(to right, var(--color-slate-200) 1px, transparent 1px) 0 0 / ${100 / hours}% 100%,
    linear-gradient(to right, var(--color-slate-100) 1px, transparent 1px) 0 0 / ${50 / hours}% 100%`

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <DaySwitcher day={dayStart} onSelect={onDayChange} todayKey={todayStart.getTime()} />

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Ingen rom er valgt. Velg rom i filteret til venstre.</p>
        ) : (
          <div
            className="grid w-max min-w-full [--label-w:104px] sm:[--label-w:168px]"
            style={{ gridTemplateColumns: `var(--label-w) minmax(${hours * HOUR_WIDTH}px, 1fr)` }}
          >
            <div className="sticky top-0 left-0 z-30 flex h-9 items-center border-r border-b border-slate-200 bg-white px-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Rom
            </div>
            <div
              className="sticky top-0 z-20 grid h-9 border-b border-slate-200 bg-white"
              style={{ gridTemplateColumns: `repeat(${hours}, 1fr)` }}
              aria-hidden
            >
              {Array.from({ length: hours }, (_, i) => (
                <div
                  key={i}
                  className={cn('pt-2 pl-1.5 text-xs text-slate-500 tabular-nums', i > 0 && 'border-l border-slate-200')}
                >
                  {String(startHour + i).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {rows.map((row, index) => {
              const last = index === rows.length - 1
              const height = Math.max(64, row.lanes * LANE_HEIGHT + TRACK_PADDING * 2)
              return (
                <RowCells key={row.id}>
                  <div
                    className={cn(
                      'sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r border-slate-200 bg-white px-3',
                      !last && 'border-b',
                    )}
                    style={{ minHeight: height }}
                  >
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{row.name}</span>
                      {row.closed && <span className="block text-xs text-slate-400">Stengt</span>}
                      {!row.closed && row.capacity && (
                        <span className="block text-xs text-slate-400 tabular-nums">{row.capacity} plasser</span>
                      )}
                    </span>
                  </div>

                  <div
                    className={cn(
                      'relative border-slate-200',
                      !last && 'border-b',
                      row.bookable && 'cursor-pointer hover:bg-slate-50/70',
                    )}
                    style={{ minHeight: height, background: hourLines }}
                    onClick={row.bookable ? (e) => clickFreeTime(e, row.id) : undefined}
                  >
                    {pastPct > 0 && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 left-0 bg-slate-100/60"
                        style={{ width: `${pastPct}%` }}
                      />
                    )}
                    {nowPct >= 0 && nowPct <= 100 && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-red-500"
                        style={{ left: `${nowPct}%` }}
                      />
                    )}
                    {row.items.map((item) => (
                      <BookingBlock
                        key={item.booking.id}
                        item={item}
                        roomName={row.name}
                        color={row.color}
                        organization={organizations.find((o) => o.id === item.booking.organizationId)}
                        left={pct(item.startMin)}
                        width={pct(item.endMin) - pct(item.startMin)}
                        onClick={onBookingClick}
                      />
                    ))}
                  </div>
                </RowCells>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** A row is two grid cells; the wrapper keeps them as direct grid items. */
function RowCells({ children }: { children: ReactNode }) {
  return <div className="contents">{children}</div>
}

function BookingBlock({
  item,
  roomName,
  color,
  organization,
  left,
  width,
  onClick,
}: {
  item: Placed
  roomName: string
  color: string
  organization?: Organization
  left: number
  width: number
  onClick: (id: string) => void
}) {
  const { booking } = item
  const pending = booking.status === 'PENDING'
  const night = crossesMidnight(booking.start, booking.end)
  const time = formatTimeRange(booking.start, booking.end)
  const label = `${booking.title}, ${time}, ${roomName}${pending ? ', venter på godkjenning' : ''}${booking.seriesId ? ', gjentakende' : ''}${night ? ', nattbooking' : ''}`
  return (
    <button
      type="button"
      aria-label={label}
      title={`${booking.title}\n${time}${organization ? `\n${organization.name}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick(booking.id)
      }}
      className="@container absolute z-[5] flex min-w-0 flex-col overflow-hidden rounded-md px-1.5 py-1 text-left text-xs leading-snug shadow-[0_0_0_1px_white] transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
      style={{
        left: `${left}%`,
        width: `${width}%`,
        top: TRACK_PADDING + item.lane * LANE_HEIGHT,
        height: LANE_HEIGHT - 4,
        ...(pending
          ? {
              backgroundColor: tint(color, 0.1),
              backgroundImage: `repeating-linear-gradient(-45deg, transparent 0 6px, color-mix(in srgb, ${color} 9%, transparent) 6px 12px)`,
              border: `1.5px dashed ${color}`,
              color,
            }
          : { backgroundColor: color, border: `1.5px solid ${color}`, color: '#fff' }),
      }}
    >
      <span className="flex items-center gap-1 font-semibold">
        {pending && <Hourglass className="size-3 shrink-0" />}
        <span className="truncate">{booking.title}</span>
        {booking.seriesId && <Repeat className="size-3 shrink-0 opacity-80" />}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        {night && <NightBadge compact onColor={!pending} labelClassName="hidden @[14rem]:inline" />}
        <span className="truncate opacity-90">
          {time}
          {organization && ` · ${organization.name}`}
        </span>
      </span>
    </button>
  )
}

/** The days of the shown week, so any weekday is one click away. */
function DaySwitcher({ day, onSelect, todayKey }: { day: Date; onSelect: (day: Date) => void; todayKey: number }) {
  const monday = addDays(day, -((day.getDay() + 6) % 7))
  return (
    <div role="tablist" aria-label="Ukedag" className="flex gap-1 overflow-x-auto px-0.5 pb-0.5">
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(monday, i)
        const selected = d.getTime() === day.getTime()
        const today = d.getTime() === todayKey
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-current={today ? 'date' : undefined}
            onClick={() => onSelect(d)}
            className={cn(
              'flex min-w-10 flex-1 flex-col items-center rounded-xl px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600',
              selected ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <span className="text-[11px] font-semibold tracking-wide uppercase">
              {d.toLocaleDateString('nb-NO', { weekday: 'short' }).replace('.', '')}
            </span>
            <span className={cn('text-base tabular-nums', today && !selected && 'font-semibold text-blue-700')}>
              {d.getDate()}
            </span>
          </button>
        )
      })}
    </div>
  )
}
