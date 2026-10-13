import { CalendarCheck, Send } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { IS_DEMO } from '../../config'
import type { BookingDraft } from '../../context/appContext'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import { combineDateTime, formatTimeRange, toDateInput, toTimeInput } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { evaluateBooking, getPermission } from '../../services/bookingRules'
import type { Organization } from '../../types'
import { Button } from '../ui/Button'
import { Alert, Field, Input, Select, Textarea } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { PermissionBadge, RoomDot } from './badges'

function defaultStart(): Date {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return d
}

/** End time "00:00" means midnight at the end of the selected day. */
function endIso(date: string, time: string): string {
  const iso = combineDateTime(date, time)
  if (!iso || time !== '00:00') return iso
  const d = new Date(iso)
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

export function BookingDialog({ draft }: { draft: BookingDraft }) {
  const app = useApp()
  const { data, currentUser, visibleRoomIds } = app
  const formId = useId()

  const orgs = currentUser.organizationIds
    .map((id) => app.organization(id))
    .filter((o): o is Organization => Boolean(o))

  const initialStart = draft.start ? new Date(draft.start) : defaultStart()
  const initialEnd = draft.end ? new Date(draft.end) : new Date(initialStart.getTime() + 3_600_000)
  const initialOrg = orgs[0]?.id ?? ''
  const initialRoom =
    draft.roomId ??
    [...data.rooms]
      .sort((a, b) => Number(visibleRoomIds.includes(b.id)) - Number(visibleRoomIds.includes(a.id)))
      .find((r) => getPermission(r, initialOrg) !== 'NONE')?.id ??
    data.rooms[0]?.id

  const [date, setDate] = useState(toDateInput(initialStart))
  const [startTime, setStartTime] = useState(toTimeInput(initialStart))
  const [endTime, setEndTime] = useState(toTimeInput(initialEnd))
  const [organizationId, setOrganizationId] = useState(initialOrg)
  const [roomId, setRoomId] = useState(initialRoom)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const input = {
    roomId,
    organizationId,
    title,
    description,
    start: combineDateTime(date, startTime),
    end: endIso(date, endTime),
  }
  const room = app.room(roomId)
  const permission = getPermission(room, organizationId)
  // Live check ignores the title so the form doesn't nag before the user has typed it.
  const live = evaluateBooking(data, currentUser, { ...input, title: title || '-' })
  const titleMissing = submitted && !title.trim()

  const changeOrganization = (id: string) => {
    setOrganizationId(id)
    if (getPermission(app.room(roomId), id) === 'NONE') {
      const alternative = data.rooms.find((r) => getPermission(r, id) !== 'NONE')
      if (alternative) setRoomId(alternative.id)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setSubmitError(null)
    if (!title.trim() || !live.ok) return
    setBusy(true)
    try {
      const booking = await app.createBooking(input)
      app.notify(
        booking.status === 'APPROVED'
          ? `${room?.name} er booket.`
          : `Søknad om ${room?.name} er sendt til administrator.`,
      )
      app.closeBookingDialog()
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const isRequest = permission === 'REQUEST'
  const cannotBook = orgs.length === 0 || permission === 'NONE'

  return (
    <Modal
      title={isRequest ? 'Søk om rom' : 'Ny booking'}
      onClose={app.closeBookingDialog}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={app.closeBookingDialog}>
            Avbryt
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy || cannotBook}>
            {isRequest ? <Send className="size-4" /> : <CalendarCheck className="size-4" />}
            {isRequest ? 'Send søknad' : 'Book rom'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
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
              <Input id={`${formId}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Fra" htmlFor={`${formId}-start`}>
            <Input id={`${formId}-start`} type="time" step={900} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="Til" htmlFor={`${formId}-end`}>
            <Input id={`${formId}-end`} type="time" step={900} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>

        {orgs.length === 0 ? (
          <Alert tone="warning">
            {currentUser.name} er ikke medlem av noen organisasjon og kan ikke booke rom.{' '}
            {IS_DEMO
              ? 'Bytt til en organisasjonsbruker øverst til høyre for å teste booking.'
              : 'Be en administrator om å legge deg til i en organisasjon.'}
          </Alert>
        ) : (
          <Field
            label="Book på vegne av"
            htmlFor={`${formId}-org`}
            hint={orgs.length === 1 ? 'Du er medlem av én organisasjon.' : undefined}
          >
            <Select
              id={`${formId}-org`}
              value={organizationId}
              onChange={(e) => changeOrganization(e.target.value)}
              disabled={orgs.length === 1}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Rom</legend>
          <div className="grid gap-2">
            {data.rooms.map((r) => {
              const p = getPermission(r, organizationId)
              const selected = r.id === roomId
              const disabled = p === 'NONE'
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
                      {r.capacity} plasser · {r.location}
                    </span>
                  </span>
                  <PermissionBadge permission={p} />
                </label>
              )
            })}
          </div>
        </fieldset>

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

        {orgs.length > 0 && renderFeedback()}
        {submitError && <Alert tone="error">{submitError}</Alert>}
      </form>
    </Modal>
  )

  function renderFeedback() {
    if (!live.ok) {
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
