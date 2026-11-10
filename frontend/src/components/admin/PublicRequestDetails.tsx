import {
  AlignLeft,
  Building2,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  Clock,
  Inbox,
  Mail,
  MapPin,
  Moon,
  Pencil,
  Plus,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../hooks/useApp'
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
  bookingCalendarLink,
  bookingDescription,
  contactProblem,
  emptyContact,
  formatPhone,
  type GuardsEvent,
  guardsEventOfRequest,
  guardsEmail,
  isOpenRequest,
  MAX_CONTACTS,
  PUBLIC_REQUEST_STATUSES,
  publicRequestStatusLabels,
  publicRequestStatusTones,
  replyEmail,
  requestedRoom,
  requestWhen,
} from '../../services/publicRequests'
import { NightBadge } from '../booking/badges'
import { EmailButton } from '../email/EmailDialog'
import { ContactFields } from '../publicRequest/ContactFields'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert, Field, Input, Select, Textarea } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { Chip } from './Chip'

/** "Send til vektere": a ready-made order in the shared email dialog. */
export function GuardsLink({ event }: { event: GuardsEvent }) {
  return (
    <EmailButton title="Send til vektere" draft={() => guardsEmail(event)}>
      <ShieldAlert className="size-4" /> Send til vektere
    </EmailButton>
  )
}

/** "Booking opprettet" or "Booking slettet", for the list and the details. */
export function BookingChip({ request: r }: { request: PublicRequest }) {
  if (r.booking) return <Chip label="Booking opprettet" tone="default" />
  if (r.bookingRemovedAt) return <Chip label="Booking slettet" tone="red" />
  return null
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <span className="mt-0.5 text-slate-400 [&>svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1 text-sm text-slate-700">{children}</div>
    </div>
  )
}

type Mode = 'view' | 'edit' | 'reject'

/**
 * A public request in a dialog, in the same pattern as a booking's details: what was sent, the
 * status, who changed it last, and the booking made from it, with its time and room read live
 * from the booking. The actions live here: Rediger, Opprett booking, Send til vektere, Avslå.
 */
export function PublicRequestDetails({
  request: r,
  onClose,
  onChanged,
}: {
  request: PublicRequest
  onClose: () => void
  /** After any change: reload the requests (and the app's data). */
  onChanged: () => void
}) {
  const app = useApp()
  const id = useId()
  const [mode, setMode] = useState<Mode>('view')
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const when = requestWhen(r)
  const overnight = crossesMidnight(when.start, when.end)
  const passed = isOpenRequest(r) && Date.parse(when.start) <= now

  const setStatus = async (status: PublicRequestStatus, cancelBooking = false) => {
    setError(null)
    try {
      await adminApi.setPublicRequestStatus(r.id, status, cancelBooking)
      app.notify(cancelBooking ? 'Forespørselen er avslått, og bookingen er slettet.' : `Status: ${publicRequestStatusLabels[status]}.`)
      setMode('view')
    } catch (err) {
      setError(errorMessage(err))
      setMode('view')
    }
    onChanged()
  }

  const createBooking = () => {
    onClose()
    app.openBookingDialog({
      start: r.start,
      end: r.end,
      // No room for "Ingen preferanse" or a room that is gone or closed: the admin picks one.
      roomId: requestedRoom(app.data.rooms, r)?.id ?? '',
      title: r.eventName,
      description: bookingDescription(r),
      publicRequestId: r.id,
      onCreated: onChanged,
    })
  }

  if (mode === 'edit') {
    return (
      <Modal title="Rediger forespørselen" size="lg" onClose={() => setMode('view')}>
        <RequestEditor
          request={r}
          onCancel={() => setMode('view')}
          onSaved={(bookingNotUpdated) => {
            app.notify(
              bookingNotUpdated
                ? 'Forespørselen er endret. Bookingen ble ikke oppdatert, fordi den har startet.'
                : r.booking
                  ? 'Forespørselen og bookingen er endret.'
                  : 'Forespørselen er endret.',
              bookingNotUpdated ? 'info' : undefined,
            )
            setMode('view')
            onChanged()
          }}
        />
      </Modal>
    )
  }

  if (mode === 'reject') {
    return r.booking ? (
      <Modal
        title="Avslå forespørselen?"
        onClose={() => setMode('view')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode('view')} className="mr-auto">
              Avbryt
            </Button>
            <Button onClick={() => setStatus('REJECTED')}>Behold bookingen</Button>
            <Button variant="danger" onClick={() => setStatus('REJECTED', true)}>
              Slett bookingen
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Forespørselen har en booking: «{r.booking.title}», {r.booking.roomName}, {formatDate(r.booking.start)}{' '}
          {formatTimeRange(r.booking.start, r.booking.end)}. Skal bookingen slettes også? Søkeren får ikke beskjed automatisk, så gi
          beskjed på e-post til {r.email}.
        </p>
      </Modal>
    ) : (
      <ConfirmDialog
        title="Avslå forespørselen?"
        confirmLabel="Avslå"
        destructive
        onConfirm={() => setStatus('REJECTED')}
        onClose={() => setMode('view')}
      >
        Forespørselen fra {r.organizationName} markeres som avslått. Søkeren får ikke beskjed automatisk, så gi beskjed på e-post
        til {r.email}.
      </ConfirmDialog>
    )
  }

  return (
    <Modal
      title={r.eventName}
      onClose={onClose}
      footer={
        <>
          {r.status !== 'REJECTED' && (
            <Button variant="danger" onClick={() => setMode('reject')} className="mr-auto">
              <X className="size-4" /> Avslå
            </Button>
          )}
          {overnight && r.status !== 'REJECTED' && <GuardsLink event={guardsEventOfRequest(r)} />}
          <Button size="sm" onClick={() => setMode('edit')}>
            <Pencil className="size-4" /> Rediger
          </Button>
          {isOpenRequest(r) && !r.booking && (
            <Button size="sm" variant="primary" onClick={createBooking}>
              <CalendarPlus className="size-4" /> Opprett booking
            </Button>
          )}
        </>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Chip label={publicRequestStatusLabels[r.status]} tone={publicRequestStatusTones[r.status]} />
        <BookingChip request={r} />
        {passed && <Chip label="Tidspunktet har passert" tone="amber" />}
        {overnight && <NightBadge />}
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor={`${id}-status`} className="text-xs text-slate-500">
            Status
          </label>
          <Select
            id={`${id}-status`}
            className="h-8! w-auto!"
            value={r.status}
            onChange={(e) => {
              const status = e.target.value as PublicRequestStatus
              // Rejecting a request with a booking asks whether to delete the booking too.
              if (status === 'REJECTED' && r.booking) setMode('reject')
              else void setStatus(status)
            }}
          >
            {PUBLIC_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {publicRequestStatusLabels[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error && (
        <Alert tone="error" className="mb-2">
          {error}
        </Alert>
      )}

      <div className="divide-y divide-slate-100">
        <Row icon={<Clock />}>
          <p className="font-medium text-slate-900 first-letter:uppercase">{formatDate(when.start)}</p>
          <p>
            {formatTimeRange(when.start, when.end)}
            {overnight && ` (over midnatt, slutter ${formatDate(when.end)})`}
          </p>
          {when.booked && (r.start !== when.start || r.end !== when.end) && (
            <p className="text-xs text-slate-500">
              Ønsket: {formatDate(r.start)}, {formatTimeRange(r.start, r.end)}
            </p>
          )}
        </Row>
        <Row icon={<MapPin />}>
          <p className="font-medium text-slate-900">{when.roomName ?? 'Ingen preferanse'}</p>
          {!when.booked && <p className="text-slate-500">Ønsket rom. Endelig rom velges når bookingen opprettes.</p>}
        </Row>
        <Row icon={r.booking ? <CalendarCheck /> : r.bookingRemovedAt ? <CalendarX /> : <CalendarPlus />}>
          {r.booking ? (
            <>
              <p>
                Booking: <span className="font-medium text-slate-900">{r.booking.title}</span>
                {r.booking.status !== 'APPROVED' && <span className="text-slate-500"> ({r.booking.status === 'PENDING' ? 'venter' : r.booking.status.toLowerCase()})</span>}
              </p>
              <p className="text-slate-500">Tid og rom hentes fra bookingen.</p>
              <Link to={bookingCalendarLink(r.booking)} className="text-sm font-medium text-blue-700 hover:underline">
                Vis i kalenderen
              </Link>
            </>
          ) : r.bookingRemovedAt ? (
            <p>
              <span className="font-medium text-red-700">Booking slettet</span>
              <span className="text-slate-500"> · {formatDateTime(r.bookingRemovedAt)}</span>
            </p>
          ) : (
            <p className="text-slate-500">{r.status === 'DONE' ? 'Ingen booking i systemet.' : 'Ingen booking ennå.'}</p>
          )}
        </Row>
        <Row icon={<Building2 />}>
          <p className="font-medium text-slate-900">{r.organizationName}</p>
          <p className="text-slate-500">
            Medlem av Kulturstyret/Studentersamfunnet: {r.memberOfKulturstyretOrSamfunnet ? 'Ja' : 'Nei'}
          </p>
        </Row>
        <Row icon={<Mail />}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="break-all text-slate-900">{r.email}</span>
            <EmailButton title={`Svar til ${r.email}`} draft={() => replyEmail(r)}>
              <Mail className="size-4" /> Svar på e-post
            </EmailButton>
          </div>
        </Row>
        {r.contacts.length > 0 && (
          <Row icon={<Users />}>
            <ul className="space-y-1">
              {r.contacts.map((c, i) => (
                <li key={i}>
                  <span className="font-medium text-slate-900">{c.name}</span> ({c.organization}) · kortnr. {c.cardNumber} ·{' '}
                  <a href={`tel:${c.phone}`} className="text-blue-700 hover:underline">
                    {formatPhone(c.phone)}
                  </a>
                </li>
              ))}
            </ul>
          </Row>
        )}
        <Row icon={<AlignLeft />}>
          <p className="whitespace-pre-line">{r.description}</p>
        </Row>
        <Row icon={<Inbox />}>
          Sendt <span className="text-slate-500">· {formatDateTime(r.createdAt)}</span>
        </Row>
        {r.updatedAt && (
          <Row icon={<Pencil />}>
            Sist endret{r.updatedByName && ` av ${r.updatedByName}`}
            <span className="text-slate-500"> · {formatDateTime(r.updatedAt)}</span>
          </Row>
        )}
      </div>
    </Modal>
  )
}

/**
 * Editing a request, at any status, with the same fields as the form; the server checks the same
 * rules (except that the time may have passed). With a booking, the time and room shown are the
 * booking's, and saving moves the booking and regenerates its text, or saves nothing.
 */
function RequestEditor({
  request: r,
  onCancel,
  onSaved,
}: {
  request: PublicRequest
  onCancel: () => void
  /** `bookingNotUpdated`: the booking has started, so only the request got the new text. */
  onSaved: (bookingNotUpdated: boolean) => void
}) {
  const app = useApp()
  const id = useId()
  const when = requestWhen(r)
  const [email, setEmail] = useState(r.email)
  const [organizationName, setOrganizationName] = useState(r.organizationName)
  const [eventName, setEventName] = useState(r.eventName)
  const [member, setMember] = useState(r.memberOfKulturstyretOrSamfunnet)
  const [roomId, setRoomId] = useState(r.booking?.roomId ?? r.preferredRoomId ?? '')
  const [date, setDate] = useState(toDateInput(new Date(when.start)))
  const [startTime, setStartTime] = useState(toTimeInput(new Date(when.start)))
  const [endTime, setEndTime] = useState(toTimeInput(new Date(when.end)))
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
  const problem =
    missing ??
    (startTime === endTime ? 'Starttidspunkt og sluttidspunkt kan ikke være like.' : null) ??
    (r.booking && !roomId ? 'Velg et rom. Forespørselen har en booking.' : null) ??
    contacts.map(contactProblem).find((p) => p) ??
    null

  const save = async () => {
    setSubmitted(true)
    setError(null)
    if (problem) return
    setBusy(true)
    try {
      const saved = await adminApi.updatePublicRequest(r.id, {
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
      onSaved(saved.bookingNotUpdated)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {r.booking && (
        <Alert tone="info">
          Forespørselen har en booking. Tid og rom under er bookingens: endrer du dem, flyttes bookingen etter de vanlige reglene. Nytt
          navn, ny beskrivelse eller nye kontaktpersoner oppdaterer bookingens tittel og beskrivelse, så lenge bookingen ikke har
          startet.
        </Alert>
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
        <Field label={r.booking ? 'Rom (bookingen)' : 'Ønsket rom'} htmlFor={`${id}-room`}>
          <Select id={`${id}-room`} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {!r.booking && <option value="">Ingen preferanse</option>}
            {r.booking && !rooms.some((room) => room.id === r.booking!.roomId) && (
              <option value={r.booking.roomId}>{r.booking.roomName} (arkivert)</option>
            )}
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
    </div>
  )
}
