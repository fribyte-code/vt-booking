import type { Booking } from '../types'

/**
 * "Legg til i kalender" links. Google and Outlook have add-event links; Apple Calendar has none,
 * so it gets the backend's iCalendar file, which Safari on iPhone opens in the Calendar app.
 * Only Google links can repeat (an RRULE); Outlook links always make a single event.
 */

export interface CalendarEvent {
  title: string
  start: string
  end: string
  location: string
  details: string
}

/** Every `intervalWeeks` weeks, `count` times, at the same local time. */
export interface WeeklyRule {
  intervalWeeks: number
  count: number
}

const query = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

/** `20261029T170000Z` */
const compactUtc = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}/, '').replace(/[-:]/g, '')

/** `2026-10-29T17:00:00Z` */
const isoUtc = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}/, '')

export function googleCalendarUrl(event: CalendarEvent, rule?: WeeklyRule): string {
  const params: Record<string, string> = {
    action: 'TEMPLATE',
    text: event.title,
    dates: `${compactUtc(event.start)}/${compactUtc(event.end)}`,
    details: event.details,
    location: event.location,
  }
  if (rule) {
    params.recur = `RRULE:FREQ=WEEKLY;INTERVAL=${rule.intervalWeeks};COUNT=${rule.count}`
    // Repeats at the same local time across daylight saving changes, like the series itself.
    params.ctz = Intl.DateTimeFormat().resolvedOptions().timeZone
  }
  return `https://calendar.google.com/calendar/render?${query(params)}`
}

/** `office` for work and school accounts (Microsoft 365), `live` for personal Outlook.com accounts. */
export function outlookCalendarUrl(event: CalendarEvent, host: 'office' | 'live'): string {
  return `https://outlook.${host}.com/calendar/0/deeplink/compose?${query({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: isoUtc(event.start),
    enddt: isoUtc(event.end),
    body: event.details,
    location: event.location,
  })}`
}

/** The backend's iCalendar file for a booking or a whole series (API mode only). */
export function calendarFileUrl(target: { bookingId: string } | { seriesId: string }): string {
  return 'seriesId' in target
    ? `/api/bookings/series/${target.seriesId}/calendar.ics`
    : `/api/bookings/${target.bookingId}/calendar.ics`
}

/** Approved occurrences that have not ended, in order. */
export function upcomingApproved(bookings: Booking[], now = new Date()): Booking[] {
  return bookings
    .filter((b) => b.status === 'APPROVED' && new Date(b.end) > now)
    .sort((a, b) => a.start.localeCompare(b.start))
}

const localDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000
const duration = (b: Booking) => new Date(b.end).getTime() - new Date(b.start).getTime()

/**
 * The rule that gives exactly these occurrences (sorted), or null when none does: they must be in
 * the same room, at the same local time and length, a fixed number of weeks apart. A cancelled or
 * moved occurrence breaks the pattern.
 */
export function weeklyRule(occurrences: Booking[]): WeeklyRule | null {
  if (occurrences.length < 2) return null
  const [first, second] = occurrences.map((b) => new Date(b.start))
  const stepDays = localDay(second) - localDay(first)
  if (stepDays <= 0 || stepDays % 7 !== 0) return null

  const regular = occurrences.every((b, i) => {
    const start = new Date(b.start)
    return (
      b.roomId === occurrences[0].roomId &&
      duration(b) === duration(occurrences[0]) &&
      start.getHours() === first.getHours() &&
      start.getMinutes() === first.getMinutes() &&
      localDay(start) - localDay(first) === i * stepDays
    )
  })
  return regular ? { intervalWeeks: stepDays / 7, count: occurrences.length } : null
}
