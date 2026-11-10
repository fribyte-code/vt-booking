import { Building2, CalendarDays, Clock, FileText, MapPin, Moon, Repeat, ShieldCheck, Users } from 'lucide-react'
import { type ReactNode, useCallback, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import { formatDate, formatDateTime, formatTimeRange } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { adminApi, type NightEvent, type NightKind } from '../../services/adminApi'
import {
  DEFAULT_NIGHT_FILTER,
  filterNight,
  guardsEventOfNight,
  NIGHT_KINDS,
  type NightFilter,
  nightKindLabels,
} from '../../services/night'
import { bookingCalendarLink, formatPhone } from '../../services/publicRequests'
import { EmptyState } from '../booking/BookingListItem'
import { DateBlock } from '../booking/DateBlock'
import { NightBadge } from '../booking/badges'
import { Button } from '../ui/Button'
import { Alert, Select } from '../ui/fields'
import { Segmented } from '../ui/Segmented'
import { Modal } from '../ui/Modal'
import { Chip } from './Chip'
import { GuardsLink, PublicRequestDetails } from './PublicRequestDetails'
import { useAdminData } from './useAdminData'

const kindTones: Record<NightKind, 'default' | 'amber' | 'dark'> = {
  BOOKING: 'default',
  REQUEST: 'amber',
  PUBLIC_REQUEST: 'dark',
}

const keyOf = (e: NightEvent) => e.bookingId ?? e.publicRequestId ?? ''

/**
 * Natt, for system admins: every coming event past midnight in every room (confirmed bookings,
 * series included, pending applications and public requests not rejected), as a compact list. A
 * row opens the details, where guards are ticked off as ordered ("Vektere bestilt") and ordered
 * with "Send til vektere". The tab's badge counts those without guards.
 */
export function NightAdmin() {
  const app = useApp()
  const load = useCallback(() => Promise.all([adminApi.night(), adminApi.publicRequests()]), [])
  const { data, error, reload } = useAdminData(load)
  const [filter, setFilter] = useState<NightFilter>(DEFAULT_NIGHT_FILTER)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <p className="text-sm text-slate-500">Laster natt-oversikten …</p>
  const [events, requests] = data

  const changed = () => {
    reload()
    app.reload()
  }

  const shown = filterNight(events, filter)
  const open = openKey ? events.find((e) => keyOf(e) === openKey) : undefined
  const request = requestId ? requests.find((r) => r.id === requestId) : undefined
  // Every room an event is in, also archived ones the room list leaves out.
  const rooms = [...new Map(events.filter((e) => e.roomId).map((e) => [e.roomId!, e.roomName ?? ''])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], 'nb'),
  )

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Kommende arrangementer som går over midnatt, i alle rom: bekreftede bookinger, ventende søknader og forespørsler som ikke er
        avslått. Etter midnatt trengs det vektere i tillegg til villavakt. Huk av når vektere er bestilt.
      </p>

      <NightFilterBar events={events} rooms={rooms} filter={filter} onChange={setFilter} shown={shown.length} />

      {shown.length === 0 ? (
        <EmptyState icon={<Moon />} title={events.length === 0 ? 'Ingen arrangementer over midnatt' : 'Ingen arrangementer matcher filtreringen'} />
      ) : (
        <ul className="space-y-2">
          {shown.map((e) => (
            <NightRow key={keyOf(e)} event={e} onOpen={() => setOpenKey(keyOf(e))} />
          ))}
        </ul>
      )}

      {open && !request && (
        <NightDetails
          key={keyOf(open)}
          event={open}
          onClose={() => setOpenKey(null)}
          onChanged={changed}
          onOpenRequest={open.publicRequestId ? () => setRequestId(open.publicRequestId) : undefined}
        />
      )}
      {request && (
        <PublicRequestDetails key={request.id} request={request} onClose={() => setRequestId(null)} onChanged={changed} />
      )}
    </div>
  )
}

/** One type at a time (with counts), the room, "only without guards". */
function NightFilterBar({
  events,
  rooms,
  filter,
  onChange,
  shown,
}: {
  events: NightEvent[]
  rooms: [string, string][]
  filter: NightFilter
  onChange: (filter: NightFilter) => void
  shown: number
}) {
  const id = useId()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Type"
        value={filter.kind}
        onChange={(kind) => onChange({ ...filter, kind })}
        options={[
          { id: 'ALL' as const, label: 'Alle', count: events.length },
          ...NIGHT_KINDS.map((k) => ({ id: k, label: nightKindLabels[k], count: events.filter((e) => e.kind === k).length })),
        ]}
      />
      <label htmlFor={`${id}-room`} className="sr-only">
        Rom
      </label>
      <Select id={`${id}-room`} className="h-8! w-auto!" value={filter.roomId} onChange={(e) => onChange({ ...filter, roomId: e.target.value })}>
        <option value="">Alle rom</option>
        {rooms.map(([roomId, name]) => (
          <option key={roomId} value={roomId}>
            {name}
          </option>
        ))}
      </Select>
      <label className="flex h-8 cursor-pointer items-center gap-2 rounded-full px-3 text-sm text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50">
        <input type="checkbox" checked={filter.withoutGuards} onChange={(e) => onChange({ ...filter, withoutGuards: e.target.checked })} />
        Bare uten vektere
      </label>
      <p role="status" className="ml-auto text-sm text-slate-500 tabular-nums">
        {shown} av {events.length}
      </p>
    </div>
  )
}

function GuardsChip({ event: e }: { event: NightEvent }) {
  return e.guardsOrderedAt ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-emerald-800 ring-1 ring-emerald-200 ring-inset">
      <ShieldCheck className="size-3" /> Vektere bestilt
    </span>
  ) : (
    <Chip label="Vektere ikke bestilt" tone="red" />
  )
}

function NightRow({ event: e, onOpen }: { event: NightEvent; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full gap-4 rounded-xl bg-white p-3 text-left ring-1 ring-slate-200 transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <DateBlock date={e.start} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-900">{e.title}</span>
            <Chip label={nightKindLabels[e.kind]} tone={kindTones[e.kind]} />
            {e.seriesId && <Repeat className="size-3.5 text-slate-400" aria-label="Gjentakende" />}
            <GuardsChip event={e} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 [&_svg]:size-3.5 [&_svg]:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Clock /> <span className="sr-only">{formatDate(e.start)}, </span>
              {formatTimeRange(e.start, e.end)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin /> {e.roomName ?? 'Ingen preferanse'}
            </span>
            <span className="flex items-center gap-1.5">
              <Building2 /> {e.organizationName}
            </span>
          </div>
        </div>
      </button>
    </li>
  )
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <span className="mt-0.5 text-slate-400 [&>svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1 text-sm text-slate-700">{children}</div>
    </div>
  )
}

/** An event past midnight: when, where, who, and the guards. */
function NightDetails({
  event: e,
  onClose,
  onChanged,
  onOpenRequest,
}: {
  event: NightEvent
  onClose: () => void
  onChanged: () => void
  /** For an event from a public request: show the request itself. */
  onOpenRequest?: () => void
}) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setGuards = async (ordered: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await adminApi.setGuards(e, ordered)
      app.notify(ordered ? 'Merket: vektere bestilt.' : 'Vektere er ikke lenger merket som bestilt.')
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={e.title}
      onClose={onClose}
      footer={
        <>
          {onOpenRequest && (
            <Button size="sm" onClick={onOpenRequest} className="mr-auto">
              <FileText className="size-4" /> Åpne forespørselen
            </Button>
          )}
          {e.bookingId && (
            <Link
              to={bookingCalendarLink({ id: e.bookingId, start: e.start })}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50',
                !onOpenRequest && 'mr-auto',
              )}
            >
              <CalendarDays className="size-4" /> Vis i kalenderen
            </Link>
          )}
          <GuardsLink event={guardsEventOfNight(e)} />
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Chip label={nightKindLabels[e.kind]} tone={kindTones[e.kind]} />
        {e.seriesId && <Chip label="Gjentakende" />}
        <NightBadge />
      </div>
      {error && (
        <Alert tone="error" className="mb-2">
          {error}
        </Alert>
      )}
      <div className="divide-y divide-slate-100">
        <Row icon={<Clock />}>
          <p className="font-medium text-slate-900 first-letter:uppercase">{formatDate(e.start)}</p>
          <p>
            {formatTimeRange(e.start, e.end)} (slutter {formatDate(e.end)})
          </p>
        </Row>
        <Row icon={<MapPin />}>
          <p className="font-medium text-slate-900">{e.roomName ?? 'Ingen preferanse'}</p>
          {e.kind === 'PUBLIC_REQUEST' && <p className="text-slate-500">Ønsket rom. Forespørselen er ikke booket ennå.</p>}
        </Row>
        <Row icon={<Building2 />}>{e.organizationName}</Row>
        <Row icon={<Users />}>
          <ul className="space-y-1">
            {e.contacts.map((c, i) => (
              <li key={i}>
                <span className="font-medium text-slate-900">{c.name}</span> ({c.organization})
                {c.phone && (
                  <>
                    {' · '}
                    <a href={`tel:${c.phone}`} className="text-blue-700 hover:underline">
                      {formatPhone(c.phone)}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Row>
        <Row icon={<ShieldCheck />}>
          <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-900">
            <input type="checkbox" checked={!!e.guardsOrderedAt} disabled={busy} onChange={(ev) => setGuards(ev.target.checked)} />
            Vektere bestilt
          </label>
          {e.guardsOrderedAt ? (
            <p className="text-slate-500">
              Huket av{e.guardsOrderedByName && ` av ${e.guardsOrderedByName}`} · {formatDateTime(e.guardsOrderedAt)}
            </p>
          ) : (
            <p className="text-slate-500">Bestill med «Send til vektere», og huk av når det er gjort.</p>
          )}
        </Row>
      </div>
    </Modal>
  )
}
