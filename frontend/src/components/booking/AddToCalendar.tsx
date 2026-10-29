import { CalendarPlus, ChevronDown, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IS_DEMO } from '../../config'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import {
  type CalendarEvent,
  calendarFileUrl,
  googleCalendarUrl,
  outlookCalendarUrl,
  upcomingApproved,
  weeklyRule,
} from '../../lib/calendarLinks'
import { errorMessage } from '../../lib/errors'
import type { Booking } from '../../types'
import { Button } from '../ui/Button'
import { ScopeChoice } from './ScopeChoice'

type Scope = 'one' | 'series'

interface CalendarLink {
  label: string
  href?: string
  /** Why the link is missing for this choice. */
  unavailable?: string
  /** The iCalendar file opens in the same tab, so Safari hands it to the Calendar app. */
  sameTab?: boolean
}

/** The series' upcoming approved occurrences, loaded when "Hele serien" is chosen. */
interface Series {
  seriesId: string
  bookings?: Booking[]
  error?: string
}

/**
 * "Legg til i kalender": links that open the booking in Google Calendar, Apple Calendar or
 * Outlook. A copy, so later changes to the booking don't reach the user's calendar.
 */
export function AddToCalendar({ booking }: { booking: Booking }) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('one')
  const [series, setSeries] = useState<Series | null>(null)
  const { listSeries } = app
  const seriesId = booking.seriesId
  const wantsSeries = open && scope === 'series' && seriesId !== undefined

  useEffect(() => {
    if (!wantsSeries) return
    let cancelled = false
    listSeries(seriesId).then(
      (bookings) => !cancelled && setSeries({ seriesId, bookings: upcomingApproved(bookings) }),
      (err: unknown) => !cancelled && setSeries({ seriesId, error: errorMessage(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [wantsSeries, seriesId, listSeries])

  if (booking.status !== 'APPROVED' || new Date(booking.end) <= new Date()) return null

  const toEvent = (b: Booking): CalendarEvent => {
    const room = app.roomOf(b)
    const location = room.room?.location
    return {
      title: b.title,
      start: b.start,
      end: b.end,
      location: location ? `${room.name}, ${location}` : room.name,
      details: [`Booket for ${app.organization(b.organizationId)?.name ?? 'organisasjonen'}`, b.description]
        .filter(Boolean)
        .join('\n\n'),
    }
  }

  const loaded = series?.seriesId === seriesId ? series : null
  const occurrences = scope === 'series' ? loaded?.bookings : undefined
  let links: CalendarLink[] = []
  if (scope === 'one') {
    const event = toEvent(booking)
    links = [
      { label: 'Google Kalender', href: googleCalendarUrl(event) },
      ...(IS_DEMO ? [] : [{ label: 'Apple Kalender', href: calendarFileUrl({ bookingId: booking.id }), sameTab: true }]),
      { label: 'Outlook (jobb/skole)', href: outlookCalendarUrl(event, 'office') },
      { label: 'Outlook.com', href: outlookCalendarUrl(event, 'live') },
    ]
  } else if (occurrences?.length) {
    const rule = weeklyRule(occurrences)
    const noRepeat = 'Outlook-lenker kan ikke gjenta en hendelse. Velg «Kun denne».'
    links = [
      rule
        ? { label: 'Google Kalender', href: googleCalendarUrl(toEvent(occurrences[0]), rule) }
        : occurrences.length === 1
          ? { label: 'Google Kalender', href: googleCalendarUrl(toEvent(occurrences[0])) }
          : {
              label: 'Google Kalender',
              unavailable: 'Serien har flyttede eller kansellerte datoer, som Google-lenker ikke kan gjengi.',
            },
      ...(IS_DEMO ? [] : [{ label: 'Apple Kalender', href: calendarFileUrl({ seriesId: seriesId! }), sameTab: true }]),
      { label: 'Outlook (jobb/skole)', unavailable: noRepeat },
      { label: 'Outlook.com', unavailable: noRepeat },
    ]
  }

  return (
    <div className="mt-3">
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <CalendarPlus className="size-4" /> Legg til i kalender
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </Button>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3">
          {seriesId && (
            <ScopeChoice
              legend="Hva vil du legge til?"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'one', label: 'Kun denne' },
                {
                  value: 'series',
                  label: 'Hele serien',
                  hint: occurrences
                    ? `${occurrences.length} kommende ${occurrences.length === 1 ? 'booking' : 'bookinger'}`
                    : 'Godkjente bookinger som ikke er passert',
                },
              ]}
            />
          )}
          {scope === 'series' && !loaded && <p className="text-sm text-slate-500">Henter serien …</p>}
          {loaded?.error && <p className="text-sm text-red-700">Kunne ikke hente serien: {loaded.error}</p>}
          {occurrences?.length === 0 && (
            <p className="text-sm text-slate-500">Serien har ingen kommende godkjente bookinger.</p>
          )}
          {links.length > 0 && (
            <ul className="grid gap-1.5">
              {links.map((link) => (
                <li key={link.label}>
                  {link.href ? (
                    <a
                      href={link.href}
                      {...(link.sameTab ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                      className="flex h-10 items-center justify-between rounded-lg bg-white px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      {link.label}
                      <ExternalLink className="size-4 text-slate-400" />
                    </a>
                  ) : (
                    <div className="rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 ring-inset">
                      <span className="font-medium text-slate-400">{link.label}</span>
                      <span className="block text-xs text-slate-500">{link.unavailable}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">
            Kalenderen får en kopi. Endres eller kanselleres bookingen senere, må du oppdatere den selv.
          </p>
        </div>
      )}
    </div>
  )
}
