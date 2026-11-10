import { ArrowLeft, CalendarCheck, Repeat, Save, Send } from 'lucide-react'
import { type FormEvent, useEffect, useId, useState } from 'react'
import type { BookingDraft } from '../../context/appContext'
import { useApp } from '../../hooks/useApp'
import { useSeriesPreview } from '../../hooks/useSeriesPreview'
import { cn } from '../../lib/cn'
import {
  combineDateTime,
  combineEnd,
  crossesMidnight,
  formatDate,
  formatTimeRange,
  nextDateInput,
  toDateInput,
  toTimeInput,
} from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { adminApi } from '../../services/adminApi'
import { organizationsForRequest } from '../../services/publicRequests'
import { BookingError } from '../../services/bookingError'
import { evaluateBooking, evaluateEdit, getPermission, roomsOnBehalf, type RuleResult, type EditResult } from '../../services/bookingRules'
import type { Booking, CreateSeriesInput, Organization, SeriesUpdated } from '../../types'
import { Button } from '../ui/Button'
import { Alert, Field, Input, Select, Textarea } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { PermissionBadge, RoomDot } from './badges'
import { ScopeChoice } from './ScopeChoice'
import { OccurrenceList } from './SeriesPreview'

function defaultStart(): Date {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return d
}

/**
 * The selected day in local time, for loading the room's bookings that day, or that day and the
 * next for a booking past midnight. The end is a local midnight, so days with a daylight saving
 * change (23 or 25 hours) are covered exactly.
 */
function dayRange(date: string, days: number): { start: string; end: string } | null {
  const start = new Date(`${date}T00:00`)
  if (Number.isNaN(start.getTime())) return null
  const end = new Date(start)
  end.setDate(end.getDate() + days)
  return { start: start.toISOString(), end: end.toISOString() }
}

/** The room's bookings on one day, fetched for the dialog. `key` tells which room and day they are for. */
interface Availability {
  key: string
  bookings?: Booking[]
  error?: string
}

/** The local date `weeks` weeks after `date` (`YYYY-MM-DD`). */
function weeksLater(date: string, weeks: number): string {
  const d = new Date(`${date}T12:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + weeks * 7)
  return toDateInput(d)
}

const intervalLabels: Record<number, string> = {
  0: 'Ikke gjenta',
  1: 'Ukentlig',
  2: 'Hver 2. uke',
  3: 'Hver 3. uke',
  4: 'Hver 4. uke',
}

type EditScope = 'single' | 'following'

/**
 * Creates a booking or a weekly series, or with `draft.bookingId` edits an existing booking (the
 * organization is fixed). For an occurrence of a series the user picks whether the following
 * occurrences change too; that edit is first tried as a dry run, so the user sees what changes.
 */
export function BookingDialog({ draft }: { draft: BookingDraft }) {
  const app = useApp()
  if (draft.bookingId) {
    const booking = app.data.bookings.find((b) => b.id === draft.bookingId)
    // The booking disappeared, e.g. it was cancelled elsewhere and the data reloaded.
    if (!booking) return null
    return <BookingForm draft={draft} editing={booking} />
  }
  return <BookingForm draft={draft} />
}

function BookingForm({ draft, editing }: { draft: BookingDraft; editing?: Booking }) {
  // The booking as it was when the form opened. Its version goes with the save, so a change
  // someone else made meanwhile gives a conflict instead of being overwritten by this form.
  const [original] = useState(editing)
  const app = useApp()
  const { data, currentUser } = app
  const formId = useId()

  // From a public request, an admin books for any active organization ("Eksterne" first).
  const fromRequest = !editing ? draft.publicRequestId : undefined
  const forRequest = fromRequest ? organizationsForRequest(data.organizations) : null
  const orgs = editing
    ? [app.organization(editing.organizationId) ?? { id: editing.organizationId, name: 'Organisasjonen', description: '' }]
    : forRequest
      ? forRequest.options
      : currentUser.organizationIds.map((id) => app.organization(id)).filter((o): o is Organization => Boolean(o))

  const initialStart = editing ? new Date(editing.start) : draft.start ? new Date(draft.start) : defaultStart()
  const initialEnd = editing
    ? new Date(editing.end)
    : draft.end
      ? new Date(draft.end)
      : new Date(initialStart.getTime() + 3_600_000)
  // Booking a public request, the admin needs no access to the room (the server checks the same).
  const rooms = fromRequest ? roomsOnBehalf(data.rooms, orgs.map((o) => o.id)) : data.rooms
  const roomById = (id: string) => rooms.find((r) => r.id === id)
  // A public request goes to "Eksterne" unless the admin picks another; without it, nothing is preselected.
  const initialOrg = forRequest ? forRequest.preselected : (orgs[0]?.id ?? '')
  // Only a room the user already chose (the booking edited, a room column in the calendar, a public
  // request's room) is preselected. Otherwise the user picks one, so nobody books the wrong room
  // by accident.
  const initialRoom = editing?.roomId ?? draft.roomId ?? ''

  const [date, setDate] = useState(toDateInput(initialStart))
  const [startTime, setStartTime] = useState(toTimeInput(initialStart))
  const [endTime, setEndTime] = useState(toTimeInput(initialEnd))
  const [organizationId, setOrganizationId] = useState(initialOrg)
  const [roomId, setRoomId] = useState(initialRoom)
  const [title, setTitle] = useState(editing?.title ?? draft.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? draft.description ?? '')
  const [interval, setIntervalWeeks] = useState(0)
  const [until, setUntil] = useState(() => weeksLater(toDateInput(initialStart), 8))
  const [skipConflicts, setSkipConflicts] = useState(false)
  const [scope, setScope] = useState<EditScope>('single')
  const [review, setReview] = useState<SeriesUpdated | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [availability, setAvailability] = useState<Availability | null>(null)

  // A booking in an archived room can only get a new title or description.
  const roomArchived = !!editing && !app.room(editing.roomId)

  const start = combineDateTime(date, startTime)
  const end = combineEnd(date, startTime, endTime)
  const overnight = !!start && !!end && crossesMidnight(start, end)

  // The calendar only has bookings for the range it shows, so the dialog loads the selected
  // room's bookings for the selected day (and the next one, past midnight) itself. Otherwise a
  // date outside that range would look free.
  const { listBookings } = app
  const day = dayRange(date, overnight ? 2 : 1)
  const availabilityKey = day && roomId && !roomArchived ? `${roomId}|${day.start}|${day.end}` : null
  useEffect(() => {
    if (!availabilityKey) return
    const [room, start, end] = availabilityKey.split('|')
    const range = { start, end }
    let cancelled = false
    listBookings(range, room).then(
      (bookings) => !cancelled && setAvailability({ key: availabilityKey, bookings }),
      (err: unknown) => !cancelled && setAvailability({ key: availabilityKey, error: errorMessage(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [availabilityKey, listBookings])
  const current = availability?.key === availabilityKey ? availability : null
  const dayBookings = current?.bookings
  const checking = !!availabilityKey && !current

  const input = {
    roomId,
    organizationId,
    title,
    description,
    start,
    end,
  }
  const room = roomById(roomId)
  const permission = getPermission(room, organizationId)
  const checkData = { ...data, rooms, bookings: dayBookings ?? data.bookings }
  // The server lets an admin book a public request for any organization, so the live check does too.
  const checkUser = fromRequest ? { ...currentUser, organizationIds: [organizationId] } : currentUser
  const repeating = !editing && !fromRequest && interval > 0
  // Live check ignores the title so the form doesn't nag before the user has typed it. It uses the
  // day's bookings once they are loaded; the server checks again when the booking is sent.
  const live: RuleResult | EditResult = editing
    ? evaluateEdit(checkData, currentUser, editing, { ...input, title: title || '-' })
    : evaluateBooking(checkData, checkUser, { ...input, title: title || '-' })
  // In a series, a taken first date is shown in the preview and can be skipped like the others.
  const blocking = !live.ok && !(repeating && live.code === 'CONFLICT')

  const seriesInput: CreateSeriesInput | null =
    repeating && !blocking && until
      ? {
          roomId,
          organizationId,
          // The preview only needs a valid title; the real one is sent when the series is created.
          title: '-',
          start: input.start,
          end: input.end,
          recurrence: { intervalWeeks: interval, until },
        }
      : null
  const preview = useSeriesPreview(seriesInput)
  const occurrences = preview.occurrences ?? []
  const taken = occurrences.filter((o) => o.conflict).length
  const allTaken = occurrences.length > 0 && taken === occurrences.length

  const occupied = (dayBookings ?? [])
    .filter((b) => b.id !== editing?.id && (b.status === 'APPROVED' || b.status === 'PENDING'))
    .sort((a, b) => a.start.localeCompare(b.start))
  const titleMissing = submitted && !title.trim()

  const changeOrganization = (id: string) => {
    setOrganizationId(id)
    // A room the new organization can't book is deselected rather than swapped for another.
    if (roomId && getPermission(roomById(roomId), id) === 'NONE') setRoomId('')
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setSubmitError(null)
    try {
      await action()
    } catch (err) {
      setSubmitError(
        err instanceof BookingError && err.code === 'VERSION_CONFLICT' && editing
          ? 'Bookingen er endret av noen andre mens du redigerte. Lukk og åpne den på nytt for å se endringene.'
          : errorMessage(err),
      )
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setSubmitError(null)
    if (!title.trim() || blocking) return

    if (editing) {
      const moved = live.ok && 'moved' in live && live.moved
      if (editing.seriesId && scope === 'following' && moved) {
        // Show what would change first. Taken dates are reported instead of failing the dry run.
        await run(async () => {
          setReview(await app.updateSeries(original!, input, { dryRun: true, skipConflicts: true }))
        })
        return
      }
      await run(async () => {
        if (editing.seriesId && scope === 'following') {
          const result = await app.updateSeries(original!, input)
          app.notify(`${result.updated.length} bookinger i serien er endret.`)
        } else {
          const updated = await app.updateBooking(original!, input)
          app.notify(
            updated.status === 'PENDING' && editing.status === 'APPROVED'
              ? `«${updated.title}» er endret og sendt til godkjenning.`
              : `«${updated.title}» er endret.`,
          )
        }
        app.closeBookingDialog()
      })
      return
    }

    if (repeating) {
      if (!preview.occurrences || allTaken || (taken > 0 && !skipConflicts)) return
      await run(async () => {
        const result = await app.createSeries({
          ...input,
          recurrence: { intervalWeeks: interval, until },
          skipConflicts: taken > 0 && skipConflicts,
        })
        const n = result.created.length
        const pending = result.created[0]?.status === 'PENDING'
        const what = pending ? `${n} ${n === 1 ? 'søknad' : 'søknader'} om ${room?.name} er sendt` : `${n} bookinger av ${room?.name} er opprettet`
        const skipped = result.skipped.length
        app.notify(skipped > 0 ? `${what}. ${skipped} opptatte datoer ble hoppet over.` : `${what}.`)
        app.closeBookingDialog()
      })
      return
    }

    if (fromRequest) {
      await run(async () => {
        const booking = await adminApi.createBookingFromRequest(fromRequest, input)
        app.notify(
          booking.status === 'APPROVED'
            ? `${room?.name} er booket, og forespørselen er overført.`
            : `Bookingen er opprettet som en søknad som venter på godkjenning, og forespørselen er overført.`,
        )
        draft.onCreated?.()
        app.reload()
        app.closeBookingDialog()
      })
      return
    }

    await run(async () => {
      const booking = await app.createBooking(input)
      app.notify(
        booking.status === 'APPROVED'
          ? `${room?.name} er booket.`
          : `Søknad om ${room?.name} er sendt til administrator.`,
      )
      app.closeBookingDialog()
    })
  }

  const saveReviewed = (result: SeriesUpdated) =>
    run(async () => {
      const saved = await app.updateSeries(original!, input, { skipConflicts: result.skipped.length > 0 })
      const skipped = saved.skipped.length
      // Dates taken after the review are skipped too; say so instead of hiding it.
      const reviewed = new Set(result.skipped.map((s) => s.id))
      const unexpected = saved.skipped.filter((s) => !reviewed.has(s.id)).length
      app.notify(
        `${saved.updated.length} bookinger i serien er endret.` +
          (skipped > 0 ? ` ${skipped} ble stående som før fordi det nye tidspunktet var opptatt.` : '') +
          (unexpected > 0 ? ` ${unexpected} av dem ble opptatt etter at du så gjennom endringen.` : ''),
        unexpected > 0 ? 'info' : 'success',
      )
      app.closeBookingDialog()
    })

  const isRequest = permission === 'REQUEST'
  const cannotBook = orgs.length === 0 || (!editing && permission === 'NONE')
  const seriesNotReady =
    repeating && (!preview.occurrences || allTaken || (taken > 0 && !skipConflicts))

  if (editing && review) {
    return (
      <SeriesEditReview
        booking={editing}
        result={review}
        busy={busy}
        error={submitError}
        onBack={() => {
          setReview(null)
          setSubmitError(null)
        }}
        onSave={() => saveReviewed(review)}
      />
    )
  }

  const dialogTitle = editing ? 'Endre booking' : fromRequest ? 'Opprett booking fra forespørsel' : isRequest ? 'Søk om rom' : 'Ny booking'
  const toBook = occurrences.length - (skipConflicts ? taken : 0)
  const count = toBook > 0 ? ` ${toBook}` : ''
  const submitLabel = editing
    ? 'Lagre endringer'
    : repeating
      ? isRequest
        ? `Send${count} søknader`
        : `Book${count} datoer`
      : isRequest
        ? 'Send søknad'
        : 'Book rom'

  return (
    <Modal
      title={dialogTitle}
      onClose={app.closeBookingDialog}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={app.closeBookingDialog}>
            Avbryt
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy || cannotBook || blocking || seriesNotReady}>
            {editing ? <Save className="size-4" /> : isRequest ? <Send className="size-4" /> : <CalendarCheck className="size-4" />}
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
        {editing?.seriesId && (
          <ScopeChoice<EditScope>
            legend="Gjentakende booking"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'single', label: 'Bare denne' },
              {
                value: 'following',
                label: 'Denne og alle følgende',
                hint: 'Senere bookinger i serien får samme endring av rom, tid, tittel og beskrivelse.',
              },
            ]}
          />
        )}

        <Field label="Tittel" htmlFor={`${formId}-title`}>
          <Input
            id={`${formId}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="F.eks. Styremøte"
            aria-invalid={titleMissing}
            className={cn(titleMissing && 'ring-red-400')}
            maxLength={80}
          />
          {titleMissing && <p className="text-xs text-red-600">Gi bookingen en tittel.</p>}
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div className="col-span-2 sm:col-span-1">
            <Field label="Dato" htmlFor={`${formId}-date`}>
              <Input
                id={`${formId}-date`}
                type="date"
                value={date}
                disabled={roomArchived}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Fra" htmlFor={`${formId}-start`}>
            <Input
              id={`${formId}-start`}
              type="time"
              step={900}
              value={startTime}
              disabled={roomArchived}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </Field>
          <Field label="Til" htmlFor={`${formId}-end`}>
            <Input
              id={`${formId}-end`}
              type="time"
              step={900}
              value={endTime}
              disabled={roomArchived}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </Field>
        </div>
        {overnight && (
          <p className="-mt-3 text-xs text-slate-600">
            Slutter neste dag, {formatDate(end)} kl. {endTime}. Bookingen merkes som nattbooking.
          </p>
        )}

        {!editing && !fromRequest && orgs.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gjenta" htmlFor={`${formId}-repeat`}>
              <Select id={`${formId}-repeat`} value={interval} onChange={(e) => setIntervalWeeks(Number(e.target.value))}>
                {Object.entries(intervalLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            {repeating && (
              <Field label="Til og med" htmlFor={`${formId}-until`}>
                <Input
                  id={`${formId}-until`}
                  type="date"
                  min={date}
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </Field>
            )}
          </div>
        )}

        {orgs.length === 0 ? (
          <Alert tone="warning">
            {currentUser.name} er ikke medlem av noen organisasjon og kan ikke booke rom.{' '}
            Be en administrator om å legge deg til i en organisasjon.
          </Alert>
        ) : (
          <Field
            label={editing ? 'Booket på vegne av' : fromRequest ? 'Organisasjon' : 'Book på vegne av'}
            htmlFor={`${formId}-org`}
            hint={
              editing
                ? 'Organisasjonen kan ikke endres.'
                : fromRequest
                  ? 'Organisasjonen bookingen skal tilhøre.'
                  : orgs.length === 1
                    ? 'Du er medlem av én organisasjon.'
                    : undefined
            }
          >
            <Select
              id={`${formId}-org`}
              value={organizationId}
              onChange={(e) => changeOrganization(e.target.value)}
              disabled={orgs.length === 1 && !fromRequest}
            >
              {!organizationId && <option value="">Velg organisasjon</option>}
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {roomArchived ? (
          <Alert tone="info">
            {app.roomOf(editing).name} er arkivert. Du kan bare endre tittel og beskrivelse, eller kansellere bookingen.
          </Alert>
        ) : (
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-sm font-medium text-slate-700">Rom</legend>
            <div className="grid gap-2">
              {rooms.map((r) => {
                const p = getPermission(r, organizationId)
                const selected = r.id === roomId
                const closed = r.status === 'DISABLED'
                const disabled = (p === 'NONE' || closed) && !selected
                return (
                  <label
                    key={r.id}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset transition-colors focus-within:ring-2 focus-within:ring-blue-600',
                      selected ? 'bg-slate-50 ring-2 ring-slate-900' : 'ring-slate-200',
                      disabled ? 'cursor-not-allowed opacity-55' : !selected && 'cursor-pointer hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${formId}-room`}
                      className="sr-only"
                      checked={selected}
                      disabled={disabled}
                      onChange={() => setRoomId(r.id)}
                    />
                    <RoomDot color={r.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-900">{r.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[r.capacity && `${r.capacity} plasser`, r.location].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {closed ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Stengt</span>
                    ) : (
                      <PermissionBadge permission={p} />
                    )}
                  </label>
                )
              })}
            </div>
          </fieldset>
        )}

        <Field label="Beskrivelse (valgfritt)" htmlFor={`${formId}-desc`}>
          <Textarea
            id={`${formId}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={isRequest ? 'Formål med bookingen, forventet antall deltakere, utstyr …' : 'Agenda, utstyr …'}
            rows={3}
            maxLength={500}
          />
        </Field>

        {room && occupied.length > 0 && (
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
            <p className="mb-1 font-medium text-slate-700">
              Opptatt i {room.name} {overnight ? 'denne og neste dag' : 'denne dagen'}
            </p>
            <ul className="space-y-0.5 text-slate-600">
              {occupied.map((b) => (
                <li key={b.id}>
                  {overnight && toDateInput(new Date(b.start)) === nextDateInput(date) && 'Neste dag '}
                  <span className="tabular-nums">{formatTimeRange(b.start, b.end)}</span> · {b.title}
                  {app.organization(b.organizationId) && ` (${app.organization(b.organizationId)?.name})`}
                  {b.status === 'PENDING' && <span className="text-slate-500"> – søknad, holder ikke av tiden</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {repeating && renderSeriesPreview()}
        {orgs.length > 0 && renderFeedback()}
        {submitError && <Alert tone="error">{submitError}</Alert>}
      </form>
    </Modal>
  )

  function renderSeriesPreview() {
    if (blocking) return null
    if (preview.error) return <Alert tone="error">{preview.error}</Alert>
    if (preview.loading || !preview.occurrences) return <Alert tone="info">Finner datoene i serien …</Alert>
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <Repeat className="size-4 text-slate-400" /> {occurrences.length} datoer
          {taken > 0 && <span className="font-normal text-red-700">· {taken} opptatt</span>}
        </p>
        <OccurrenceList items={occurrences} />
        {allTaken ? (
          <Alert tone="error">Alle datoene er opptatt. Velg et annet tidspunkt eller rom.</Alert>
        ) : (
          taken > 0 && (
            <label className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={skipConflicts}
                onChange={(e) => setSkipConflicts(e.target.checked)}
              />
              <span>
                Hopp over datoer som er opptatt
                <span className="block text-xs text-amber-800">
                  Ellers kan ikke serien opprettes. {occurrences.length - taken} av {occurrences.length} datoer blir booket.
                </span>
              </span>
            </label>
          )
        )}
      </div>
    )
  }

  function renderFeedback() {
    if (!organizationId) return <Alert tone="info">Velg organisasjon.</Alert>
    if (!roomId) return <Alert tone="info">Velg rom.</Alert>
    if (!live.ok) {
      if (!blocking) return null
      return (
        <Alert tone="error">
          <p>{live.message}</p>
          {live.conflicts?.map((c) => (
            <p key={c.id} className="mt-1 text-xs">
              {formatTimeRange(c.start, c.end)} · {c.title} ({app.organization(c.organizationId)?.name})
            </p>
          ))}
        </Alert>
      )
    }
    if (editing && 'moved' in live) {
      if (!live.moved) return null
      if (current?.error) {
        return <Alert tone="warning">Kunne ikke sjekke om rommet er ledig ({current.error}). Det sjekkes når du lagrer.</Alert>
      }
      if (checking) return <Alert tone="info">Sjekker om rommet er ledig …</Alert>
      if (live.losesApproval) {
        return (
          <Alert tone="warning">
            {room?.name} krever godkjenning for {app.organization(organizationId)?.name}. Endrer du rom eller tid, blir
            bookingen en ny søknad, og tidsrommet holdes ikke av før en administrator har godkjent den.
          </Alert>
        )
      }
      if (live.status === 'PENDING') {
        return <Alert tone="info">Søknaden flyttes og venter fortsatt på godkjenning.</Alert>
      }
      return <Alert tone="success">Rommet er ledig. Endringen bekreftes med en gang.</Alert>
    }
    if (repeating) {
      return isRequest ? (
        <Alert tone="warning">
          {room?.name} krever godkjenning for {app.organization(organizationId)?.name}. Hver dato blir en egen søknad, og
          tidsrommene holdes ikke av før de er godkjent.
        </Alert>
      ) : null
    }
    if (current?.error) {
      return (
        <Alert tone="warning">
          Kunne ikke sjekke om rommet er ledig ({current.error}). Det sjekkes når du sender.
        </Alert>
      )
    }
    if (checking) {
      return <Alert tone="info">Sjekker om rommet er ledig …</Alert>
    }
    if (isRequest) {
      return (
        <Alert tone="warning">
          {room?.name} krever godkjenning for {app.organization(organizationId)?.name}. Søknaden sendes til
          administrator, og tidsrommet holdes ikke av før den er godkjent.
        </Alert>
      )
    }
    return <Alert tone="success">Rommet er ledig. Bookingen bekreftes med en gang.</Alert>
  }
}

/**
 * The result of a dry run of "this and all following": which occurrences change, and which keep
 * their old time because the new one is taken. Saving repeats the edit for real.
 */
function SeriesEditReview({
  booking,
  result,
  busy,
  error,
  onBack,
  onSave,
}: {
  booking: Booking
  result: SeriesUpdated
  busy: boolean
  error: string | null
  onBack: () => void
  onSave: () => void
}) {
  const app = useApp()
  const becomeRequests = result.updated.filter((b) => b.status === 'PENDING').length
  const skipped = result.skipped.length

  return (
    <Modal
      title="Endre denne og alle følgende"
      onClose={app.closeBookingDialog}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onBack} className="mr-auto">
            <ArrowLeft className="size-4" /> Tilbake
          </Button>
          <Button variant="primary" onClick={onSave} disabled={busy || result.updated.length === 0}>
            <Save className="size-4" />
            {skipped > 0 ? `Lagre ${result.updated.length}, hopp over ${skipped}` : `Lagre ${result.updated.length} endringer`}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-600">
        <p>
          «{booking.title}»: {result.updated.length} {result.updated.length === 1 ? 'booking' : 'bookinger'} i serien får nye
          tidspunkter i {result.updated[0] ? app.roomOf(result.updated[0]).name : app.roomOf(booking).name}.
        </p>
        <OccurrenceList
          items={result.updated.map((b) => ({
            id: b.id,
            start: b.start,
            end: b.end,
            note: b.status === 'PENDING' ? 'Søknad' : undefined,
          }))}
        />
        {becomeRequests > 0 && (
          <Alert tone="warning">
            {becomeRequests === result.updated.length ? 'Alle' : becomeRequests} må godkjennes av en administrator. Tidsrommene
            holdes ikke av før de er godkjent, også for bookinger som var bekreftet før.
          </Alert>
        )}
        {skipped > 0 && (
          <div className="space-y-2">
            <p className="font-medium text-slate-700">
              {skipped} {skipped === 1 ? 'dato er' : 'datoer er'} opptatt og beholder sitt gamle tidspunkt:
            </p>
            <OccurrenceList items={result.skipped.map((s) => ({ ...s, conflict: true }))} />
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
