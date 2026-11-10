import { CalendarPlus, ChevronDown, Inbox, Moon, Pencil, Plus, ShieldAlert, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import {
  combineDateTime,
  combineEnd,
  crossesMidnight,
  formatDate,
  formatDateTime,
  formatTimeRange,
  toDateInput,
  toTimeInput,
} from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { adminApi, type PublicRequest, type PublicRequestContact, type PublicRequestStatus } from '../../services/adminApi'
import {
  bookingDescription,
  contactProblem,
  DEFAULT_PUBLIC_REQUEST_FILTER,
  emptyContact,
  filterPublicRequests,
  formatPhone,
  type GuardsEvent,
  guardsEventOfRequest,
  guardsMailto,
  isOpenRequest,
  MAX_CONTACTS,
  PUBLIC_REQUEST_STATUSES,
  type PublicRequestFilter,
  publicRequestStatusLabels,
  replyMailto,
  requestedRoom,
  type TransferredBooking,
} from '../../services/publicRequests'
import type { Booking } from '../../types'
import { EmptyState } from '../booking/BookingListItem'
import { NightBadge } from '../booking/badges'
import { ContactFields } from '../publicRequest/ContactFields'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert, Field, Input, Select, Textarea } from '../ui/fields'
import { Chip } from './Chip'
import { useAdminData } from './useAdminData'

const statusTones: Record<PublicRequestStatus, 'dark' | 'amber' | 'default' | 'red'> = {
  NEW: 'dark',
  IN_PROGRESS: 'amber',
  DONE: 'default',
  REJECTED: 'red',
}

/** How far ahead the night overview looks (the bookings API allows at most 62 days). */
const NIGHT_WEEKS = 8

/** A link styled as a small secondary button: "Send til vektere" opens the mail app. */
const linkButton =
  'inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'

/**
 * System administrators: requests for Studentvillaen from the public form (/soknad). Each has a
 * handling status the admin sets (ubehandlet, under arbeid, ferdig, avslått), can be edited at any
 * time, and turned into a booking with "Opprett booking". "Natt" lists the coming events past
 * midnight, requests and bookings, with a ready-made order to the guards.
 */
export function PublicRequestsAdmin() {
  const app = useApp()
  const load = useCallback(() => adminApi.publicRequests(), [])
  const { data: requests, error, reload } = useAdminData(load)
  const [view, setView] = useState<'requests' | 'night'>('requests')
  const [filter, setFilter] = useState<PublicRequestFilter>(DEFAULT_PUBLIC_REQUEST_FILTER)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<PublicRequest | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!requests) return <p className="text-sm text-slate-500">Laster forespørsler …</p>

  const changed = () => {
    reload()
    app.reload()
  }

  const createBooking = (r: PublicRequest) => {
    setActionError(null)
    app.openBookingDialog({
      start: r.start,
      end: r.end,
      // No room for "Ingen preferanse" or a room that is gone or closed: the admin picks one.
      roomId: requestedRoom(app.data.rooms, r)?.id ?? '',
      title: r.eventName,
      description: bookingDescription(r),
      publicRequestId: r.id,
      onCreated: reload,
    })
  }

  const act = async (action: () => Promise<unknown>, done?: string) => {
    setActionError(null)
    try {
      await action()
      if (done) app.notify(done)
    } catch (err) {
      setActionError(errorMessage(err))
    }
    changed()
  }

  const shown = filterPublicRequests(requests, filter)

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

      {actionError && <Alert tone="error">{actionError}</Alert>}

      {view === 'night' ? (
        <NightOverview requests={requests} />
      ) : (
        <>
          <RequestFilterBar requests={requests} filter={filter} onChange={setFilter} shown={shown.length} />
          {shown.length === 0 ? (
            <EmptyState icon={<Inbox />} title={requests.length === 0 ? 'Ingen forespørsler ennå' : 'Ingen forespørsler matcher filtreringen'} />
          ) : (
            <ul className="space-y-3">
              {shown.map((r) =>
                editingId === r.id ? (
                  <RequestEditor
                    key={r.id}
                    request={r}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => {
                      setEditingId(null)
                      app.notify('Forespørselen er endret.')
                      changed()
                    }}
                  />
                ) : (
                  <RequestItem
                    key={r.id}
                    request={r}
                    onStatus={(status) =>
                      act(() => adminApi.setPublicRequestStatus(r.id, status), `Status: ${publicRequestStatusLabels[status]}.`)
                    }
                    actions={
                      <>
                        <Button size="sm" onClick={() => setEditingId(r.id)}>
                          <Pencil className="size-4" /> Rediger
                        </Button>
                        {isOpenRequest(r) && (
                          <Button size="sm" onClick={() => setRejecting(r)}>
                            <X className="size-4" /> Avslå
                          </Button>
                        )}
                        {isOpenRequest(r) && !r.bookingId && (
                          <Button size="sm" variant="primary" onClick={() => createBooking(r)}>
                            <CalendarPlus className="size-4" /> Opprett booking
                          </Button>
                        )}
                      </>
                    }
                  />
                ),
              )}
            </ul>
          )}
        </>
      )}

      {rejecting && (
        <ConfirmDialog
          title="Avslå forespørselen?"
          confirmLabel="Avslå"
          destructive
          onConfirm={async () => {
            await act(() => adminApi.rejectPublicRequest(rejecting.id), 'Forespørselen er avslått.')
            setRejecting(null)
          }}
          onClose={() => setRejecting(null)}
        >
          Forespørselen fra {rejecting.organizationName} markeres som avslått. Søkeren får ikke beskjed automatisk, så
          gi beskjed på e-post til {rejecting.email}.
        </ConfirmDialog>
      )}
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

/** The booking made from a request, if it is among the admin's loaded bookings (the last 90 days and on). */
function useTransferredBooking(r: PublicRequest): TransferredBooking | undefined {
  const app = useApp()
  const booking = r.bookingId ? app.data.bookings.find((b) => b.id === r.bookingId) : undefined
  return booking && { roomName: app.roomOf(booking).name, start: booking.start, end: booking.end }
}

function RequestItem({
  request: r,
  onStatus,
  actions,
}: {
  request: PublicRequest
  onStatus: (status: PublicRequestStatus) => void
  actions: ReactNode
}) {
  const id = useId()
  const booking = useTransferredBooking(r)
  const [expanded, setExpanded] = useState(false)
  const [now] = useState(() => Date.now())
  // Whether the collapsed description is cut off: only then is there anything to expand.
  const descriptionRef = useRef<HTMLParagraphElement>(null)
  const [clamped, setClamped] = useState(false)
  useEffect(() => {
    const el = descriptionRef.current
    if (!el) return
    // Fires once on observe and again when the width changes (e.g. rotating a phone).
    const observer = new ResizeObserver(() => setClamped(el.scrollHeight > el.clientHeight + 1))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const passed = isOpenRequest(r) && Date.parse(r.start) <= now
  const overnight = crossesMidnight(r.start, r.end)

  return (
    <li className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-slate-900">
            <span className="inline-block first-letter:uppercase">{formatDate(r.start)}</span>,{' '}
            {formatTimeRange(r.start, r.end)}
          </span>
          <Chip label={publicRequestStatusLabels[r.status]} tone={statusTones[r.status]} />
          {passed && <Chip label="Tidspunktet har passert" tone="amber" />}
          {overnight && <NightBadge />}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-status`} className="text-xs text-slate-500">
            Status
          </label>
          <Select
            id={`${id}-status`}
            className="h-8! w-auto!"
            value={r.status}
            onChange={(e) => onStatus(e.target.value as PublicRequestStatus)}
          >
            {PUBLIC_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {publicRequestStatusLabels[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        {/* Exactly what the applicant sent (or the admin corrected), whatever organization the booking gets. */}
        <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <Detail label="Organisasjon">{r.organizationName}</Detail>
          <Detail label="Arrangementets navn">{r.eventName}</Detail>
          <Detail label="Kontakt-e-post">
            <a href={replyMailto(r, booking)} className="text-blue-700 hover:underline" title="Åpner et ferdig utfylt svar i e-postprogrammet">
              {r.email}
            </a>
          </Detail>
          <Detail label="Medlem av Kulturstyret/Studentersamfunnet">{r.memberOfKulturstyretOrSamfunnet ? 'Ja' : 'Nei'}</Detail>
          <Detail label="Ønsket rom">{r.preferredRoomName ?? 'Ingen preferanse'}</Detail>
          <Detail label="Dato og tid">
            <span className="inline-block first-letter:uppercase">{formatDate(r.start)}</span>, {formatTimeRange(r.start, r.end)}
            {overnight && ` (slutter ${formatDate(r.end)})`}
          </Detail>
          {r.contacts.length > 0 && (
            <Detail label="Ansvarlige">
              <ul className="space-y-1">
                {r.contacts.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium">{c.name}</span> ({c.organization}) · kortnr. {c.cardNumber} ·{' '}
                    <a href={`tel:${c.phone}`} className="text-blue-700 hover:underline">
                      {formatPhone(c.phone)}
                    </a>
                  </li>
                ))}
              </ul>
            </Detail>
          )}
          <Detail label="Beskrivelse">
            <p ref={descriptionRef} className={cn('whitespace-pre-line', !expanded && 'line-clamp-3')}>
              {r.description}
            </p>
            {(clamped || expanded) && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
              >
                <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
                {expanded ? 'Vis mindre' : 'Vis hele beskrivelsen'}
              </button>
            )}
          </Detail>
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          Sendt {formatDateTime(r.createdAt)}
          {r.bookingId ? ' · Booking opprettet' : r.status === 'DONE' && ' · Ingen booking i systemet'}
          {r.updatedAt && ` · Sist endret ${formatDateTime(r.updatedAt)}${r.updatedByName ? ` av ${r.updatedByName}` : ''}`}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        {actions}
        {overnight && r.status !== 'REJECTED' && <GuardsLink event={guardsEventOfRequest(r, booking)} />}
      </div>
    </li>
  )
}

function GuardsLink({ event }: { event: GuardsEvent }) {
  return (
    <a href={guardsMailto(event)} className={linkButton} title="Åpner en ferdig utfylt bestilling i e-postprogrammet">
      <ShieldAlert className="size-4" /> Send til vektere
    </a>
  )
}

/**
 * Editing a request in place, at any status. The same fields as the form; the server checks the
 * same rules (except that the time may have passed). The booking made from it is not changed.
 */
function RequestEditor({ request: r, onCancel, onSaved }: { request: PublicRequest; onCancel: () => void; onSaved: () => void }) {
  const app = useApp()
  const id = useId()
  const [email, setEmail] = useState(r.email)
  const [organizationName, setOrganizationName] = useState(r.organizationName)
  const [eventName, setEventName] = useState(r.eventName)
  const [member, setMember] = useState(r.memberOfKulturstyretOrSamfunnet)
  const [roomId, setRoomId] = useState(r.preferredRoomId ?? '')
  const [date, setDate] = useState(toDateInput(new Date(r.start)))
  const [startTime, setStartTime] = useState(toTimeInput(new Date(r.start)))
  const [endTime, setEndTime] = useState(toTimeInput(new Date(r.end)))
  const [description, setDescription] = useState(r.description)
  const [contacts, setContacts] = useState<PublicRequestContact[]>(() => (r.contacts.length ? r.contacts : [emptyContact()]))
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const start = combineDateTime(date, startTime)
  const end = combineEnd(date, startTime, endTime)
  const rooms = app.data.rooms
  const missing =
    !email.trim() || !organizationName.trim() || !eventName.trim() || !description.trim() || !start || !end
      ? 'Fyll ut e-post, organisasjon, arrangementets navn, tidspunkt og beskrivelse.'
      : null
  const problem = missing ?? (startTime === endTime ? 'Starttidspunkt og sluttidspunkt kan ikke være like.' : null) ?? contacts.map(contactProblem).find((p) => p) ?? null

  const save = async () => {
    setSubmitted(true)
    setError(null)
    if (problem) return
    setBusy(true)
    try {
      await adminApi.updatePublicRequest(r.id, {
        email: email.trim(),
        organizationName: organizationName.trim(),
        eventName: eventName.trim(),
        memberOfKulturstyretOrSamfunnet: member,
        preferredRoomId: roomId || null,
        start,
        end,
        description: description.trim(),
        contacts: contacts.map((c) => ({
          name: c.name.trim(),
          organization: c.organization.trim(),
          cardNumber: c.cardNumber.trim(),
          phone: c.phone.trim(),
        })),
      })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <li className="space-y-4 rounded-xl bg-white p-4 ring-2 ring-slate-900">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">Rediger forespørselen</h3>
        <Chip label={publicRequestStatusLabels[r.status]} tone={statusTones[r.status]} />
      </div>
      {r.bookingId && (
        <Alert tone="info">Bookingen som ble laget fra forespørselen, endres ikke. Endre den i kalenderen om nødvendig.</Alert>
      )}
      {submitted && (problem || error) && <Alert tone="error">{problem ?? error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="E-postadresse" htmlFor={`${id}-email`}>
          <Input id={`${id}-email`} type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Organisasjonsnavn" htmlFor={`${id}-org`}>
          <Input id={`${id}-org`} value={organizationName} maxLength={120} onChange={(e) => setOrganizationName(e.target.value)} />
        </Field>
        <Field label="Arrangementets navn" htmlFor={`${id}-event`}>
          <Input id={`${id}-event`} value={eventName} maxLength={80} onChange={(e) => setEventName(e.target.value)} />
        </Field>
        <Field label="Medlem av Kulturstyret eller Studentersamfunnet" htmlFor={`${id}-member`}>
          <Select id={`${id}-member`} value={member ? 'yes' : 'no'} onChange={(e) => setMember(e.target.value === 'yes')}>
            <option value="yes">Ja</option>
            <option value="no">Nei</option>
          </Select>
        </Field>
        <Field label="Ønsket rom" htmlFor={`${id}-room`}>
          <Select id={`${id}-room`} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Ingen preferanse</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2">
          <Field label="Dato" htmlFor={`${id}-date`}>
            <Input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Fra" htmlFor={`${id}-start`}>
            <Input id={`${id}-start`} type="time" step={900} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="Til" htmlFor={`${id}-end`}>
            <Input id={`${id}-end`} type="time" step={900} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
      </div>
      {start && end && crossesMidnight(start, end) && (
        <p className="flex items-center gap-1.5 text-xs text-indigo-900">
          <Moon className="size-3.5" /> Slutter {formatDate(end)} kl. {endTime}.
        </p>
      )}
      <Field label="Beskrivelse" htmlFor={`${id}-desc`}>
        <Textarea id={`${id}-desc`} rows={4} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">Ansvarlige personer</legend>
        {contacts.map((c, i) => (
          <ContactFields
            key={i}
            index={i}
            contact={c}
            showErrors={submitted}
            onChange={(patch) => setContacts((cs) => cs.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
            onRemove={contacts.length > 1 ? () => setContacts((cs) => cs.filter((_, j) => j !== i)) : undefined}
          />
        ))}
        {contacts.length < MAX_CONTACTS && (
          <Button size="sm" onClick={() => setContacts((cs) => [...cs, emptyContact()])}>
            <Plus className="size-4" /> Legg til person
          </Button>
        )}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Avbryt
        </Button>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Lagrer …' : 'Lagre endringer'}
        </Button>
      </div>
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
          ? guardsEventOfRequest(request, { roomName: room.name, start: b.start, end: b.end })
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
          where: r.preferredRoomName ?? 'Ingen preferanse',
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

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-800">{children}</dd>
    </>
  )
}
