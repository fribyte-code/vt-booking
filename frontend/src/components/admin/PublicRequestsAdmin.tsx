import { Building2, Clock, Inbox, MapPin, Moon } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import { crossesMidnight, formatDate, formatTimeRange } from '../../lib/dates'
import { adminApi, type PublicRequest, type PublicRequestStatus } from '../../services/adminApi'
import {
  DEFAULT_PUBLIC_REQUEST_FILTER,
  filterPublicRequests,
  isOpenRequest,
  PUBLIC_REQUEST_STATUSES,
  type PublicRequestFilter,
  publicRequestStatusLabels,
  publicRequestStatusTones,
  requestWhen,
} from '../../services/publicRequests'
import { EmptyState } from '../booking/BookingListItem'
import { DateBlock } from '../booking/DateBlock'
import { NightBadge } from '../booking/badges'
import { Alert, Select } from '../ui/fields'
import { Chip } from './Chip'
import { BookingChip, PublicRequestDetails } from './PublicRequestDetails'
import { useAdminData } from './useAdminData'

/**
 * System administrators: requests for Studentvillaen from the public form (/soknad), as a compact
 * list like the bookings. A row opens the request's details, where it is edited, booked, sent to
 * the guards or rejected. A request with a booking shows the booking's time and room, read live.
 * Events past midnight, with guards, are in the Natt tab.
 */
export function PublicRequestsAdmin() {
  const app = useApp()
  const load = useCallback(() => adminApi.publicRequests(), [])
  const { data: requests, error, reload } = useAdminData(load)
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
  const passed = isOpenRequest(r) && Date.parse(when.start) <= now

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full gap-4 rounded-xl bg-white p-3 text-left ring-1 ring-slate-200 transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <DateBlock date={when.start} />
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
