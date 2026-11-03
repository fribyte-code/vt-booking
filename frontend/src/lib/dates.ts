const LOCALE = 'nb-NO'

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` in local time, for `<input type="date">`. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `HH:MM` in local time, for `<input type="time">`. */
export function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Combines local date and time inputs into an ISO 8601 string. */
export function combineDateTime(date: string, time: string): string {
  if (!date || !time) return ''
  const d = new Date(`${date}T${time}`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** The local date after `date` (`YYYY-MM-DD`). Noon avoids daylight saving edge cases. */
export function nextDateInput(date: string): string {
  const d = new Date(`${date}T12:00`)
  d.setDate(d.getDate() + 1)
  return toDateInput(d)
}

/**
 * End of a booking entered as one date and two times. An end time at or before the start time
 * means the next day, so 22:00–02:00 ends at 02:00 the day after.
 */
export function combineEnd(date: string, startTime: string, endTime: string): string {
  if (!date || !startTime || !endTime) return ''
  return combineDateTime(endTime <= startTime ? nextDateInput(date) : date, endTime)
}

/** Whether a booking goes past midnight (local time). Ending exactly at 00:00 does not count. */
export function crossesMidnight(start: string, end: string): boolean {
  const s = new Date(start)
  const lastMoment = new Date(Date.parse(end) - 1)
  return toDateInput(s) !== toDateInput(lastMoment)
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)}–${formatTime(end)}`
}

/** "tirsdag 14. oktober" (year added when it differs from the current one). */
export function formatDate(iso: string, opts: { weekday?: boolean } = { weekday: true }): string {
  const d = new Date(iso)
  return d.toLocaleDateString(LOCALE, {
    weekday: opts.weekday ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
}

export function formatDateTime(iso: string): string {
  return `${formatShortDate(iso)} kl. ${formatTime(iso)}`
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Toolbar title for the calendar's current range. */
export function formatRangeTitle(viewType: string, start: Date, endExclusive: Date): string {
  if (viewType === 'dayGridMonth') {
    // Month view starts in the previous month's last week, so use the middle of the range.
    const mid = new Date((start.getTime() + endExclusive.getTime()) / 2)
    return capitalize(mid.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }))
  }
  if (viewType === 'timeGridDay') {
    return capitalize(start.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
  }
  const end = new Date(endExclusive.getTime() - 1)
  const month = (d: Date) => d.toLocaleDateString(LOCALE, { month: 'long' })
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}.–${end.getDate()}. ${month(end)} ${end.getFullYear()}`
  }
  const startYear = start.getFullYear() === end.getFullYear() ? '' : ` ${start.getFullYear()}`
  return `${start.getDate()}. ${month(start)}${startYear} – ${end.getDate()}. ${month(end)} ${end.getFullYear()}`
}

export function isFuture(iso: string): boolean {
  return Date.parse(iso) > Date.now()
}
