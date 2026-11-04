import { CalendarRange, Send } from 'lucide-react'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Alert, Field, Input, Textarea } from '../components/ui/fields'
import { cn } from '../lib/cn'
import { combineDateTime, combineEnd, crossesMidnight, formatDate, toDateInput } from '../lib/dates'
import { errorMessage } from '../lib/errors'
import { createApiClient } from '../services/apiClient'
import { type PreferredArea, preferredAreas } from '../services/publicRequests'

const api = createApiClient()

/**
 * The texts from the Google Forms form this page replaces. Update them here if they change.
 */
const TEXT = {
  intro:
    'Dette skjemaet gjelder forespørsel om å låne et av fellesarealene i Studentvillaen i Christies gate 18. ' +
    'Før du sender inn, må du ha lest bookingreglene og Villaloven.',
  email: 'Vi svarer på forespørselen til denne adressen.',
  organization: 'Navnet på organisasjonen, foreningen eller gruppen som arrangerer.',
  eventName: 'Hva heter arrangementet?',
  member: 'Er organisasjonen medlem av Kulturstyret eller Studentersamfunnet?',
  area: 'Hvem som prioriteres er veiledende. Endelig avgjørelse tas ved behandling av forespørselen.',
  date: 'Datoen arrangementet starter.',
  time: 'Slutter arrangementet etter midnatt, velg sluttidspunktet neste dag, f.eks. 20:00–02:00.',
  description: 'Beskriv arrangementet: hva som skal skje, omtrent hvor mange som kommer, og om det blir servering.',
  villaGuard: 'Trenger dere villavakt under arrangementet?',
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
              invalid && value === null && 'ring-red-400',
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
  const [email, setEmail] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [eventName, setEventName] = useState('')
  const [member, setMember] = useState<boolean | null>(null)
  const [area, setArea] = useState<PreferredArea | null>(null)
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [description, setDescription] = useState('')
  const [villaGuard, setVillaGuard] = useState<boolean | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const start = combineDateTime(date, startTime)
  const end = combineEnd(date, startTime, endTime)
  const overnight = !!start && !!end && crossesMidnight(start, end)
  const missing = (value: string) => submitted && !value.trim()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setError(null)
    if (!email.trim() || !organizationName.trim() || !eventName.trim() || !description.trim() || !start || !end || member === null || area === null || villaGuard === null) {
      setError('Fyll ut alle feltene.')
      return
    }
    // An end time at or before the start time means the next day, so equal times would be 24 hours.
    if (startTime === endTime) {
      setError('Starttidspunkt og sluttidspunkt kan ikke være like.')
      return
    }
    setBusy(true)
    try {
      await api.send('POST', '/api/public/requests', {
        email: email.trim(),
        organizationName: organizationName.trim(),
        eventName: eventName.trim(),
        memberOfKulturstyretOrSamfunnet: member,
        preferredArea: area,
        start,
        end,
        description: description.trim(),
        needsVillaGuard: villaGuard,
      })
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

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
            <Field label="E-postadresse" htmlFor={`${id}-email`} hint={TEXT.email}>
              <Input
                id={`${id}-email`}
                type="email"
                autoComplete="email"
                value={email}
                maxLength={254}
                aria-invalid={missing(email)}
                className={cn(missing(email) && 'ring-red-400')}
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
                className={cn(missing(organizationName) && 'ring-red-400')}
                onChange={(e) => setOrganizationName(e.target.value)}
              />
            </Field>
            <Field label="Arrangementets navn" htmlFor={`${id}-event`} hint={TEXT.eventName}>
              <Input
                id={`${id}-event`}
                value={eventName}
                maxLength={80}
                aria-invalid={missing(eventName)}
                className={cn(missing(eventName) && 'ring-red-400')}
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
              <legend className="text-sm font-medium text-slate-700">Hvilket fellesareal ønsker dere å låne?</legend>
              <p className="text-xs text-slate-500">{TEXT.area}</p>
              <div className="grid gap-2 pt-1">
                {preferredAreas.map((a) => (
                  <label
                    key={a.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset focus-within:ring-2 focus-within:ring-blue-600',
                      area === a.value ? 'bg-slate-50 ring-2 ring-slate-900' : 'ring-slate-200 hover:bg-slate-50',
                      submitted && area === null && 'ring-red-400',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-area`}
                      className="mt-1"
                      checked={area === a.value}
                      onChange={() => setArea(a.value)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{a.label}</span>
                      {a.hint && <span className="block text-xs text-slate-500">{a.hint}</span>}
                    </span>
                  </label>
                ))}
              </div>
              {submitted && area === null && <p className="text-xs text-red-600">Velg et fellesareal, eller ingen preferanse.</p>}
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
                      className={cn(missing(date) && 'ring-red-400')}
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
                    className={cn(missing(startTime) && 'ring-red-400')}
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
                    className={cn(missing(endTime) && 'ring-red-400')}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </Field>
              </div>
              <p className="text-xs text-slate-500">
                {overnight ? `Slutter neste dag, ${formatDate(end)} kl. ${endTime}.` : `${TEXT.date} ${TEXT.time}`}
              </p>
            </div>

            <Field label="Beskrivelse av arrangementet" htmlFor={`${id}-desc`} hint={TEXT.description}>
              <Textarea
                id={`${id}-desc`}
                rows={5}
                value={description}
                maxLength={2000}
                aria-invalid={missing(description)}
                className={cn(missing(description) && 'ring-red-400')}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <YesNo legend="Behov for villavakt?" hint={TEXT.villaGuard} value={villaGuard} onChange={setVillaGuard} invalid={submitted} />

            {error && <Alert tone="error">{error}</Alert>}
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
