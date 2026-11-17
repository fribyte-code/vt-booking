import { Building2, CalendarCheck, Clock, Inbox, MapPin, Moon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { crossesMidnight, formatDate, formatTimeRange } from '../../lib/dates'
import { adminApi, type PublicRequest } from '../../services/adminApi'
import {
  filterPublicRequests,
  inPublicRequestView,
  isOpenRequest,
  PUBLIC_REQUEST_VIEWS,
  publicRequestStatusLabels,
  publicRequestStatusTones,
  type PublicRequestView,
  publicRequestViewLabels,
  requestWhen,
} from '../../services/publicRequests'
import { EmptyState } from '../booking/BookingListItem'
import { DateBlock } from '../booking/DateBlock'
import { Alert } from '../ui/fields'
import { Segmented } from '../ui/Segmented'
import { Chip } from './Chip'
import { PublicRequestDetails } from './PublicRequestDetails'
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
  const [view, setView] = useState<PublicRequestView>('ALL')
  const [openId, setOpenId] = useState<string | null>(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!requests) return <p className="text-sm text-slate-500">Laster forespørsler …</p>

  const changed = () => {
    reload()
    app.reload()
  }

  const shown = filterPublicRequests(requests, view)
  const open = openId ? requests.find((r) => r.id === openId) : undefined

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Sendt fra{' '}
        <a href="/soknad" target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">
          /soknad
        </a>{' '}
        av eksterne uten konto. Søkeren får ikke beskjed automatisk; svar på e-post.
      </p>

      <Segmented
        label="Vis forespørsler"
        value={view}
        onChange={setView}
        options={PUBLIC_REQUEST_VIEWS.map((v) => ({
          id: v,
          label: publicRequestViewLabels[v],
          count: requests.filter((r) => inPublicRequestView(r, v)).length,
        }))}
      />
      {shown.length === 0 ? (
        <EmptyState icon={<Inbox />} title={requests.length === 0 ? 'Ingen forespørsler ennå' : `Ingen forespørsler: ${publicRequestViewLabels[view].toLowerCase()}`} />
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <RequestRow key={r.id} request={r} showStatus={view === 'OPEN' || view === 'ALL'} onOpen={() => setOpenId(r.id)} />
          ))}
        </ul>
      )}

      {open && <PublicRequestDetails key={open.id} request={open} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  )
}

/**
 * One request on one line, like a booking in the lists: date, time, room, organizer. The status
 * shows where the view mixes statuses; a booking and past midnight are icons with a tooltip.
 * Time and room are the booking's when there is one.
 */
function RequestRow({ request: r, showStatus, onOpen }: { request: PublicRequest; showStatus: boolean; onOpen: () => void }) {
  const [now] = useState(() => Date.now())
  const when = requestWhen(r)
  const passed = isOpenRequest(r) && Date.parse(when.start) <= now
  const night = crossesMidnight(when.start, when.end)
  const nightText = `Over midnatt, slutter ${formatDate(when.end)}`
  const bookedText = 'Booking opprettet. Tid og rom hentes fra bookingen.'

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
            {showStatus && <Chip label={publicRequestStatusLabels[r.status]} tone={publicRequestStatusTones[r.status]} />}
            {!r.booking && r.bookingRemovedAt && <Chip label="Booking slettet" tone="red" />}
            {passed && <Chip label="Tidspunktet har passert" tone="amber" />}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 [&_svg]:size-3.5 [&_svg]:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Clock /> <span className="sr-only">{formatDate(when.start)}, </span>
              {formatTimeRange(when.start, when.end)}
              {night && (
                <span role="img" aria-label={nightText} title={nightText} className="[&_svg]:text-indigo-600!">
                  <Moon />
                </span>
              )}
            </span>
            <span className="flex items-center gap-1.5">
              {r.booking ? (
                <span role="img" aria-label={bookedText} title={bookedText} className="[&_svg]:text-emerald-600!">
                  <CalendarCheck />
                </span>
              ) : (
                <MapPin />
              )}
              {when.roomName ?? 'Ingen preferanse'}
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
