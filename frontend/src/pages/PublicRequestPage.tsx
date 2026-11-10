import { CalendarRange, Moon, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '../components/ui/Button'
import { Alert, Field, Input, Textarea } from '../components/ui/fields'
import { cn } from '../lib/cn'
import { combineDateTime, combineEnd, crossesMidnight, formatDate, toDateInput } from '../lib/dates'
import { errorMessage } from '../lib/errors'
import type { PublicRequestContact } from '../services/adminApi'
import { createApiClient } from '../services/apiClient'
import { CLOSED_HOURS_MESSAGE, describeOpeningHours, openingHoursMessage, overlapsClosedHours, withinOpeningHours } from '../services/bookingRules'
import {
  contactFieldProblems,
  contactProblem,
  emptyContact,
  listNorwegian,
  MAX_CONTACTS,
  missingContactFields,
  PUBLIC_REQUEST_MAX_HOURS,
  type PublicRoom,
} from '../services/publicRequests'

const api = createApiClient()

/**
 * The texts of the form. Update them here if they change.
 */
const TEXT = {
  intro:
    'Dette skjemaet gjelder forespørsel om å låne et av fellesarealene i Studentvillaen i Christies gate 18. ' +
    'Før du sender inn, må du ha lest bookingreglene og Villaloven.',
  email: 'Vi svarer på forespørselen til denne adressen.',
  organization: 'Navnet på organisasjonen, foreningen eller gruppen som arrangerer.',
  eventName: 'Hva heter arrangementet?',
  member: 'Er organisasjonen medlem av Kulturstyret eller Studentersamfunnet?',
  room: 'Endelig avgjørelse om rom tas ved behandling av forespørselen.',
  date: 'Datoen arrangementet starter.',
  time:
    'Slutter arrangementet etter midnatt, velg sluttidspunktet neste dag, f.eks. 20:00–02:00. ' +
    'Lokalene er stengt mellom kl. 05:00 og 07:00.',
  description: 'Beskriv arrangementet: hva som skal skje, omtrent hvor mange som kommer, og om det blir servering.',
  contacts:
    'Hvem er ansvarlige under arrangementet? Oppgi minst én person. Bruk kortnummeret på UiB-kortet, ikke studentnummeret.',
  villaGuard: 'Alle arrangementer må ha villavakt.',
  villaGuardNight: 'Da er villavakt ekstra viktig, og det trengs i tillegg vektere.',
  confirmation:
    'Takk! Forespørselen er sendt. Vi behandler den så snart vi kan og svarer på e-post. ' +
    'Forespørselen er ikke en bekreftet booking før du har fått svar.',
}

function YesNo({ legend, hint, value, onChange, invalid }: {
  legend: string
  hint?: ReactNode
  value: boolean | null
  onChange: (value: boolean) => void
  invalid: boolean
}) {
  const name = useId()
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div className="flex gap-2 pt-1">
        {[true, false].map((option) => (
          <label
            key={String(option)}
            className={cn(
              'flex h-10 flex-1 cursor-pointer items-center justify-center rounded-lg text-sm font-medium ring-1 ring-inset focus-within:ring-2 focus-within:ring-blue-600 sm:flex-none sm:px-6',
              value === option ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
              invalid && value === null && 'ring-red-400!',
            )}
          >
            <input type="radio" name={name} className="sr-only" checked={value === option} onChange={() => onChange(option)} />
            {option ? 'Ja' : 'Nei'}
          </label>
        ))}
      </div>
      {invalid && value === null && <p className="text-xs text-red-600">Velg ja eller nei.</p>}
    </fieldset>
  )
}

/** Public booking request for Studentvillaen, without logging in. A system admin handles it in Administrasjon. */
export function PublicRequestPage() {
  const id = useId()
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null)
  const [roomsError, setRoomsError] = useState(false)
  const [email, setEmail] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [eventName, setEventName] = useState('')
  const [member, setMember] = useState<boolean | null>(null)
  // A room id, '' for no preference, null until chosen.
  const [roomId, setRoomId] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [description, setDescription] = useState('')
  const [contacts, setContacts] = useState<PublicRequestContact[]>(() => [emptyContact()])
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  // The server's answer to the request as sent: shown only while the form is unchanged.
  const [serverError, setServerError] = useState<{ message: string; sent: string } | null>(null)
  const [sent, setSent] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .get<PublicRoom[]>('/api/public/rooms')
      .then(setRooms)
      .catch(() => setRoomsError(true))
  }, [])

  const start = combineDateTime(date, startTime)
  const end = combineEnd(date, startTime, endTime)
  const times = !!start && !!end && startTime !== endTime
  const overnight = times && crossesMidnight(start, end)
  const room = rooms?.find((r) => r.id === roomId)
  const timeProblem = !times
    ? null
    : Date.parse(end) - Date.parse(start) > PUBLIC_REQUEST_MAX_HOURS * 3_600_000
      ? `Arrangementet kan vare i høyst ${PUBLIC_REQUEST_MAX_HOURS} timer.`
      : overlapsClosedHours(start, end)
        ? CLOSED_HOURS_MESSAGE
        : room && !withinOpeningHours(room.openingHours, start, end)
          ? openingHoursMessage(room.name, room.openingHours)
          : null
  const missing = (value: string) => submitted && !value.trim()
  const setContact = (i: number, patch: Partial<PublicRequestContact>) =>
    setContacts((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  // The first thing that stops the form, worked out from what is filled in now: once it is
  // fixed, the message goes away (or names the next problem).
  const missingFields = [
    !email.trim() && 'e-postadresse',
    !organizationName.trim() && 'organisasjonsnavn',
    !eventName.trim() && 'arrangementets navn',
    member === null && 'om dere er medlem av Kulturstyret eller Studentersamfunnet',
    roomId === null && 'rom (eller ingen preferanse)',
    !date && 'dato',
    !startTime && 'starttidspunkt',
    !endTime && 'sluttidspunkt',
    !description.trim() && 'beskrivelse',
    ...missingContactFields(contacts),
  ].filter((f): f is string => !!f)
  const contactError = contacts
    .map((c, i) => {
      const problem = contactProblem(c)
      return problem && (contacts.length > 1 ? `Person ${i + 1}: ${problem}` : problem)
    })
    .find((p) => p)
  const formProblem = missingFields.length
    ? `Fyll ut ${listNorwegian(missingFields)}.`
    : // An end time at or before the start time means the next day, so equal times would be 24 hours.
      startTime === endTime
      ? 'Starttidspunkt og sluttidspunkt kan ikke være like.'
      : (timeProblem ?? contactError ?? null)

  const payload = {
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
  }
  const payloadKey = JSON.stringify(payload)
  const error = submitted
    ? (formProblem ?? (serverError?.sent === payloadKey ? serverError.message : null))
    : null

  // The error is shown at the top of the form: bring it into view, wherever the button was.
  const showError = () => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    flushSync(() => setSubmitted(true))
    if (formProblem) {
      showError()
      return
    }
    setBusy(true)
    try {
      await api.send('POST', '/api/public/requests', payload)
      setSent(true)
    } catch (err) {
      flushSync(() => setServerError({ message: errorMessage(err), sent: payloadKey }))
      showError()
    } finally {
      setBusy(false)
    }
  }

  const roomOptions: { id: string; label: string; hint?: string }[] = [
    ...(rooms ?? []).map((r) => ({
      id: r.id,
      label: r.name,
      hint: [
        r.capacity ? `Ca. ${r.capacity} personer.` : null,
        r.description,
        r.openingHours.length > 0 ? `Åpent ${describeOpeningHours(r.openingHours)}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
    })),
    { id: '', label: 'Ingen preferanse' },
  ]

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl space-y-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-slate-900 text-white">
            <CalendarRange className="size-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold text-slate-900">Rombooking</span>
            <span className="block text-xs text-slate-500">Velferdstinget Vest</span>
          </span>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Forespørsel om lån av fellesareal i Studentvillaen</h1>
          <p className="mt-2 text-sm text-slate-600">{TEXT.intro}</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <Alert tone="success">{TEXT.confirmation}</Alert>
            <Button onClick={() => window.location.reload()}>Send en ny forespørsel</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            {error && (
              <div ref={errorRef}>
                <Alert tone="error">{error}</Alert>
              </div>
            )}
            <Field label="E-postadresse" htmlFor={`${id}-email`} hint={TEXT.email}>
              <Input
                id={`${id}-email`}
                type="email"
                autoComplete="email"
                value={email}
                maxLength={254}
                aria-invalid={missing(email)}
                className={cn(missing(email) && 'ring-red-400!')}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Organisasjonsnavn" htmlFor={`${id}-org`} hint={TEXT.organization}>
              <Input
                id={`${id}-org`}
                autoComplete="organization"
                value={organizationName}
                maxLength={120}
                aria-invalid={missing(organizationName)}
                className={cn(missing(organizationName) && 'ring-red-400!')}
                onChange={(e) => setOrganizationName(e.target.value)}
              />
            </Field>
            <Field label="Arrangementets navn" htmlFor={`${id}-event`} hint={TEXT.eventName}>
              <Input
                id={`${id}-event`}
                value={eventName}
                maxLength={80}
                aria-invalid={missing(eventName)}
                className={cn(missing(eventName) && 'ring-red-400!')}
                onChange={(e) => setEventName(e.target.value)}
              />
            </Field>
            <YesNo
              legend="Medlem av Kulturstyret eller Studentersamfunnet?"
              hint={TEXT.member}
              value={member}
              onChange={setMember}
              invalid={submitted}
            />

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-slate-700">Hvilket rom ønsker dere å låne?</legend>
              <p className="text-xs text-slate-500">{TEXT.room}</p>
              {rooms === null && !roomsError ? (
                <p className="pt-1 text-sm text-slate-500">Laster rom …</p>
              ) : (
                <div className="grid gap-2 pt-1">
                  {roomsError && (
                    <Alert tone="warning">Rommene kunne ikke lastes. Du kan likevel sende uten å velge rom.</Alert>
                  )}
                  {roomOptions.map((o) => (
                    <label
                      key={o.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset focus-within:ring-2 focus-within:ring-blue-600',
                        roomId === o.id ? 'bg-slate-50 ring-2 ring-slate-900' : 'ring-slate-200 hover:bg-slate-50',
                        submitted && roomId === null && 'ring-red-400!',
                      )}
                    >
                      <input
                        type="radio"
                        name={`${id}-room`}
                        className="mt-1"
                        checked={roomId === o.id}
                        onChange={() => setRoomId(o.id)}
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-900">{o.label}</span>
                        {o.hint && <span className="block text-xs text-slate-500">{o.hint}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {submitted && roomId === null && <p className="text-xs text-red-600">Velg et rom, eller ingen preferanse.</p>}
            </fieldset>

            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
                <div className="col-span-2 sm:col-span-1">
                  <Field label="Ønsket dato" htmlFor={`${id}-date`}>
                    <Input
                      id={`${id}-date`}
                      type="date"
                      min={toDateInput(new Date())}
                      value={date}
                      aria-invalid={missing(date)}
                      className={cn(missing(date) && 'ring-red-400!')}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Starttidspunkt" htmlFor={`${id}-start`}>
                  <Input
                    id={`${id}-start`}
                    type="time"
                    step={900}
                    value={startTime}
                    aria-invalid={missing(startTime)}
                    className={cn(missing(startTime) && 'ring-red-400!')}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </Field>
                <Field label="Sluttidspunkt" htmlFor={`${id}-end`}>
                  <Input
                    id={`${id}-end`}
                    type="time"
                    step={900}
                    value={endTime}
                    aria-invalid={missing(endTime)}
                    className={cn(missing(endTime) && 'ring-red-400!')}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </Field>
              </div>
              {overnight ? (
                <div className="flex items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900 ring-1 ring-inset ring-indigo-200">
                  <Moon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <strong className="font-semibold">Går over midnatt.</strong> Starter{' '}
                    {formatDate(start)} kl. {startTime} og slutter{' '}
                    <strong className="font-semibold">
                      {formatDate(end)} kl. {endTime}
                    </strong>
                    . {TEXT.villaGuardNight}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  {TEXT.date} {TEXT.time}
                </p>
              )}
              {timeProblem && <p className="text-xs text-red-600">{timeProblem}</p>}
            </div>

            <Field label="Beskrivelse av arrangementet" htmlFor={`${id}-desc`} hint={TEXT.description}>
              <Textarea
                id={`${id}-desc`}
                rows={5}
                value={description}
                maxLength={2000}
                aria-invalid={missing(description)}
                className={cn(missing(description) && 'ring-red-400!')}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">Ansvarlige personer</legend>
              <p className="text-xs text-slate-500">{TEXT.contacts}</p>
              {contacts.map((c, i) => (
                <ContactFields
                  key={i}
                  index={i}
                  contact={c}
                  showErrors={submitted}
                  onChange={(patch) => setContact(i, patch)}
                  onRemove={contacts.length > 1 ? () => setContacts((cs) => cs.filter((_, j) => j !== i)) : undefined}
                />
              ))}
              {contacts.length < MAX_CONTACTS && (
                <Button size="sm" onClick={() => setContacts((cs) => [...cs, emptyContact()])}>
                  <Plus className="size-4" /> Legg til person
                </Button>
              )}
            </fieldset>

            <div className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <p className="font-medium text-slate-900">{TEXT.villaGuard}</p>
            </div>

            <Button type="submit" variant="primary" className="w-full sm:w-auto" disabled={busy}>
              <Send className="size-4" /> {busy ? 'Sender …' : 'Send forespørsel'}
            </Button>
          </form>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">
        Har du konto? <a href="/" className="font-medium text-blue-700 hover:underline">Logg inn</a>
      </p>
    </main>
  )
}

function ContactFields({
  index,
  contact,
  showErrors,
  onChange,
  onRemove,
}: {
  index: number
  contact: PublicRequestContact
  /** After the first submit: mark the fields that are missing or invalid. */
  showErrors: boolean
  onChange: (patch: Partial<PublicRequestContact>) => void
  onRemove?: () => void
}) {
  const id = useId()
  const problems = contactFieldProblems(contact)
  const invalid = (field: keyof PublicRequestContact) => showErrors && problems[field]
  return (
    <div className="space-y-3 rounded-xl p-3 ring-1 ring-slate-200 ring-inset">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-900">Person {index + 1}</span>
        {onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Fjern person ${index + 1}`}>
            <Trash2 className="size-4" /> Fjern
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Navn" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            autoComplete="name"
            maxLength={100}
            value={contact.name}
            aria-invalid={invalid('name')}
            className={cn(invalid('name') && 'ring-red-400!')}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
        <Field label="Organisasjon" htmlFor={`${id}-org`}>
          <Input
            id={`${id}-org`}
            maxLength={120}
            value={contact.organization}
            aria-invalid={invalid('organization')}
            className={cn(invalid('organization') && 'ring-red-400!')}
            onChange={(e) => onChange({ organization: e.target.value })}
          />
        </Field>
        <Field label="Kortnummer" htmlFor={`${id}-card`} hint="Nummeret på UiB-kortet, ikke studentnummeret.">
          <Input
            id={`${id}-card`}
            inputMode="numeric"
            maxLength={30}
            value={contact.cardNumber}
            aria-invalid={invalid('cardNumber')}
            className={cn(invalid('cardNumber') && 'ring-red-400!')}
            onChange={(e) => onChange({ cardNumber: e.target.value })}
          />
        </Field>
        <Field label="Telefonnummer" htmlFor={`${id}-phone`}>
          <Input
            id={`${id}-phone`}
            type="tel"
            autoComplete="tel"
            maxLength={30}
            value={contact.phone}
            aria-invalid={invalid('phone')}
            className={cn(invalid('phone') && 'ring-red-400!')}
            onChange={(e) => onChange({ phone: e.target.value })}
          />
        </Field>
      </div>
    </div>
  )
}
