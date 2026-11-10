import { Building2, Clock, Inbox, MapPin, Moon } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import { crossesMidnight, formatDate, formatTimeRange } from '../../lib/dates'
import { adminApi, type PublicRequest, type PublicRequestStatus } from '../../services/adminApi'
import {
  DEFAULT_PUBLIC_REQUEST_FILTER,
  filterPublicRequests,
  type GuardsEvent,
  guardsEventOfRequest,
  isOpenRequest,
  PUBLIC_REQUEST_STATUSES,
  type PublicRequestFilter,
  publicRequestStatusLabels,
  publicRequestStatusTones,
  requestWhen,
} from '../../services/publicRequests'
import type { Booking } from '../../types'
import { EmptyState } from '../booking/BookingListItem'
import { NightBadge } from '../booking/badges'
import { Alert, Select } from '../ui/fields'
import { Chip } from './Chip'
import { BookingChip, GuardsLink, PublicRequestDetails } from './PublicRequestDetails'
import { useAdminData } from './useAdminData'

/** How far ahead the night overview looks (the bookings API allows at most 62 days). */
const NIGHT_WEEKS = 8

/**
 * System administrators: requests for Studentvillaen from the public form (/soknad), as a compact
 * list like the bookings. A row opens the request's details, where it is edited, booked, sent to
 * the guards or rejected. A request with a booking shows the booking's time and room, read live.
 * "Natt" lists the coming events past midnight, requests and bookings, with an order to the guards.
 */
export function PublicRequestsAdmin() {
  const app = useApp()
  const load = useCallback(() => adminApi.publicRequests(), [])
  const { data: requests, error, reload } = useAdminData(load)
  const [view, setView] = useState<'requests' | 'night'>('requests')
  const [filter, setFilter] = useState<PublicRequestFilter>(DEFAULT_PUBLIC_REQUEST_FILTER)
  const [openId, setOpenId] = useState<string | null>(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!requests) return <p className="text-sm text-slate-500">Laster forespørsler …</p>

  const changed = () => {
    reload()
    app.reload()
  }

  const shown = filterPublicRequests(requests, filter)
  const open = openId ? requests.find((r) => r.id === openId) : undefined

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Forespørsler om fellesarealene i Studentvillaen sendt fra det offentlige skjemaet på{' '}
        <a href="/soknad" target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">
          /soknad
        </a>
        . Søkeren får ikke beskjed automatisk; svar på e-post.
      </p>

      <div role="tablist" aria-label="Visning" className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {(
          [
            ['requests', 'Forespørsler'],
            ['night', 'Natt'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium',
              view === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {id === 'night' && <Moon className="size-3.5" />}
            {label}
          </button>
        ))}
      </div>

      {view === 'night' ? (
        <NightOverview requests={requests} />
      ) : (
        <>
          <RequestFilterBar requests={requests} filter={filter} onChange={setFilter} shown={shown.length} />
          {shown.length === 0 ? (
            <EmptyState icon={<Inbox />} title={requests.length === 0 ? 'Ingen forespørsler ennå' : 'Ingen forespørsler matcher filtreringen'} />
          ) : (
            <ul className="space-y-2">
              {shown.map((r) => (
                <RequestRow key={r.id} request={r} onOpen={() => setOpenId(r.id)} />
              ))}
            </ul>
          )}
        </>
      )}

      {open && <PublicRequestDetails key={open.id} request={open} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  )
}

/** Status toggles with counts, "only past midnight", and the order. */
function RequestFilterBar({
  requests,
  filter,
  onChange,
  shown,
}: {
  requests: PublicRequest[]
  filter: PublicRequestFilter
  onChange: (filter: PublicRequestFilter) => void
  shown: number
}) {
  const id = useId()
  const toggle = (s: PublicRequestStatus) =>
    onChange({
      ...filter,
      statuses: filter.statuses.includes(s) ? filter.statuses.filter((x) => x !== s) : [...filter.statuses, s],
    })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
        {PUBLIC_REQUEST_STATUSES.map((s) => {
          const on = filter.statuses.includes(s)
          const count = requests.filter((r) => r.status === s).length
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 ring-inset',
                on ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
              )}
            >
              {publicRequestStatusLabels[s]}
              <span className={cn('text-xs tabular-nums', on ? 'text-slate-300' : 'text-slate-500')}>{count}</span>
            </button>
          )
        })}
      </div>
      <label className="flex h-8 cursor-pointer items-center gap-2 rounded-full px-3 text-sm text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50">
        <input type="checkbox" checked={filter.nightOnly} onChange={(e) => onChange({ ...filter, nightOnly: e.target.checked })} />
        <Moon className="size-3.5" /> Bare over midnatt
      </label>
      <label htmlFor={`${id}-sort`} className="sr-only">
        Sortering
      </label>
      <Select
        id={`${id}-sort`}
        className="h-8! w-auto!"
        value={filter.sort}
        onChange={(e) => onChange({ ...filter, sort: e.target.value as PublicRequestFilter['sort'] })}
      >
        <option value="start">Etter dato for arrangementet</option>
        <option value="received">Sist mottatt først</option>
      </Select>
      <p role="status" className="ml-auto text-sm text-slate-500 tabular-nums">
        {shown} av {requests.length}
      </p>
    </div>
  )
}

/**
 * One request on one line, like a booking in the lists: date, time, room, organizer, status, a
 * night badge and whether a booking was made. Time and room are the booking's when there is one.
 */
function RequestRow({ request: r, onOpen }: { request: PublicRequest; onOpen: () => void }) {
  const [now] = useState(() => Date.now())
  const when = requestWhen(r)
  const start = new Date(when.start)
  const passed = isOpenRequest(r) && Date.parse(when.start) <= now

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full gap-4 rounded-xl bg-white p-3 text-left ring-1 ring-slate-200 transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <div className="w-12 shrink-0 text-center" aria-hidden>
          <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            {start.toLocaleDateString('nb-NO', { weekday: 'short' }).replace('.', '')}
          </div>
          <div className="text-2xl leading-8 font-medium text-slate-900">{start.getDate()}</div>
          <div className="text-xs text-slate-500">{start.toLocaleDateString('nb-NO', { month: 'short' }).replace('.', '')}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-900">{r.eventName}</span>
            <Chip label={publicRequestStatusLabels[r.status]} tone={publicRequestStatusTones[r.status]} />
            <BookingChip request={r} />
            {passed && <Chip label="Tidspunktet har passert" tone="amber" />}
            {crossesMidnight(when.start, when.end) && <NightBadge />}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 [&_svg]:size-3.5 [&_svg]:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Clock /> <span className="sr-only">{formatDate(when.start)}, </span>
              {formatTimeRange(when.start, when.end)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin /> {when.roomName ?? 'Ingen preferanse'}
              {!when.booked && when.roomName && <span className="text-slate-400">(ønsket)</span>}
            </span>
            <span className="flex items-center gap-1.5">
              <Building2 /> {r.organizationName}
            </span>
          </div>
        </div>
      </button>
    </li>
  )
}

/** One coming event past midnight: an approved booking or an undecided or accepted request. */
interface NightItem {
  key: string
  start: string
  end: string
  title: string
  where: string
  who: string
  kind: string
  guards: GuardsEvent
}

/**
 * Natt: the coming {NIGHT_WEEKS} weeks' events that go past midnight, approved bookings in every
 * room and requests that aren't rejected, so the admin sees when guards are needed and orders
 * them. A request that became a booking is shown once, as the booking with the request's contacts.
 */
function NightOverview({ requests }: { requests: PublicRequest[] }) {
  const app = useApp()
  const [from] = useState(() => new Date())
  const { listBookings } = app
  const load = useCallback(
    () =>
      listBookings({
        start: from.toISOString(),
        end: new Date(from.getTime() + NIGHT_WEEKS * 7 * 86_400_000).toISOString(),
      }),
    [from, listBookings],
  )
  const { data: bookings, error } = useAdminData(load)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!bookings) return <p className="text-sm text-slate-500">Laster natt-oversikten …</p>

  const requestOf = (b: Booking) => requests.find((r) => r.bookingId === b.id)
  const items: NightItem[] = [
    ...bookings
      .filter((b) => b.status === 'APPROVED' && crossesMidnight(b.start, b.end))
      .map((b): NightItem => {
        const room = app.roomOf(b)
        const organization = app.organization(b.organizationId)?.name ?? 'Ukjent organisasjon'
        const request = requestOf(b)
        const guards: GuardsEvent = request
          ? guardsEventOfRequest(request)
          : {
              title: b.title,
              organization,
              place: room.name,
              start: b.start,
              end: b.end,
              contacts: [b.requestedByName ? `${b.requestedByName} (booket av)` : organization],
            }
        return { key: `b-${b.id}`, start: b.start, end: b.end, title: b.title, where: room.name, who: organization, kind: 'Booking', guards }
      }),
    ...requests
      .filter(
        (r) =>
          r.status !== 'REJECTED' &&
          !(r.bookingId && bookings.some((b) => b.id === r.bookingId)) &&
          Date.parse(r.end) > from.getTime() &&
          crossesMidnight(r.start, r.end),
      )
      .map(
        (r): NightItem => ({
          key: `r-${r.id}`,
          start: r.start,
          end: r.end,
          title: r.eventName,
          where: requestWhen(r).roomName ?? 'Ingen preferanse',
          who: r.organizationName,
          kind: `Forespørsel · ${publicRequestStatusLabels[r.status].toLowerCase()}`,
          guards: guardsEventOfRequest(r),
        }),
      ),
  ].sort((a, b) => a.start.localeCompare(b.start))

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Arrangementer som går over midnatt de neste {NIGHT_WEEKS} ukene: bekreftede bookinger i alle rom, og forespørsler som
        ikke er avslått. Etter midnatt trengs det vektere i tillegg til villavakt.
      </p>
      {items.length === 0 ? (
        <EmptyState icon={<Moon />} title="Ingen arrangementer over midnatt" />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  <span className="inline-block first-letter:uppercase">{formatDate(item.start)}</span>,{' '}
                  {formatTimeRange(item.start, item.end)}
                  <span className="font-normal text-slate-500"> (slutter {formatDate(item.end)})</span>
                </p>
                <p className="text-sm text-slate-700">
                  {item.title} · {item.where} · {item.who}
                </p>
              </div>
              <Chip label={item.kind} tone={item.kind === 'Booking' ? 'default' : 'amber'} />
              <GuardsLink event={item.guards} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
