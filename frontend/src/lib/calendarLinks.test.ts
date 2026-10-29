import { describe, expect, it } from 'vitest'
import type { Booking } from '../types'
import { googleCalendarUrl, outlookCalendarUrl, upcomingApproved, weeklyRule, type CalendarEvent } from './calendarLinks'

const event: CalendarEvent = {
  title: 'Styremøte & mat',
  start: '2026-11-03T17:00:00.000Z',
  end: '2026-11-03T19:00:00.000Z',
  location: 'Storsalen',
  details: 'Booket for Organisasjon A',
}

/** A booking at a local date and time, e.g. `occurrence('2026-11-03', '18:00')`. */
function occurrence(date: string, time: string, overrides: Partial<Booking> = {}): Booking {
  const start = new Date(`${date}T${time}`)
  return {
    id: `${date}-${time}`,
    roomId: 'room',
    organizationId: 'org',
    requestedById: 'user',
    title: 'Øving',
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
    status: 'APPROVED',
    requiresApproval: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('calendar links', () => {
  it('builds a Google link with UTC times and encoded text', () => {
    const url = new URL(googleCalendarUrl(event))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('Styremøte & mat')
    expect(url.searchParams.get('dates')).toBe('20261103T170000Z/20261103T190000Z')
    expect(url.searchParams.has('recur')).toBe(false)
  })

  it('adds a weekly recurrence and time zone to the Google link', () => {
    const url = new URL(googleCalendarUrl(event, { intervalWeeks: 2, count: 5 }))
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5')
    expect(url.searchParams.get('ctz')).toBeTruthy()
  })

  it('builds Outlook links for both account types', () => {
    const office = new URL(outlookCalendarUrl(event, 'office'))
    expect(office.host).toBe('outlook.office.com')
    expect(office.searchParams.get('startdt')).toBe('2026-11-03T17:00:00Z')
    expect(office.searchParams.get('subject')).toBe('Styremøte & mat')
    expect(new URL(outlookCalendarUrl(event, 'live')).host).toBe('outlook.live.com')
  })
})

describe('weeklyRule', () => {
  it('finds the interval and count of a regular series', () => {
    const series = ['2026-11-03', '2026-11-17', '2026-12-01'].map((d) => occurrence(d, '18:00'))
    expect(weeklyRule(series)).toEqual({ intervalWeeks: 2, count: 3 })
  })

  it('keeps the local time across the end of summer time', () => {
    const series = ['2026-10-20', '2026-10-27', '2026-11-03'].map((d) => occurrence(d, '18:00'))
    expect(weeklyRule(series)).toEqual({ intervalWeeks: 1, count: 3 })
  })

  it('gives no rule when an occurrence is missing, moved or in another room', () => {
    expect(weeklyRule(['2026-11-03', '2026-11-10', '2026-11-24'].map((d) => occurrence(d, '18:00')))).toBeNull()
    expect(weeklyRule([occurrence('2026-11-03', '18:00'), occurrence('2026-11-10', '19:00')])).toBeNull()
    expect(weeklyRule([occurrence('2026-11-03', '18:00'), occurrence('2026-11-10', '18:00', { roomId: 'other' })])).toBeNull()
    expect(weeklyRule([occurrence('2026-11-03', '18:00')])).toBeNull()
  })

  it('only counts approved occurrences that have not ended', () => {
    const now = new Date('2026-11-05T12:00:00Z')
    const list = [
      occurrence('2026-11-10', '18:00'),
      occurrence('2026-11-03', '18:00'),
      occurrence('2026-11-17', '18:00', { status: 'CANCELLED' }),
      occurrence('2026-11-24', '18:00', { status: 'PENDING' }),
    ]
    expect(upcomingApproved(list, now).map((b) => b.id)).toEqual(['2026-11-10-18:00'])
  })
})
