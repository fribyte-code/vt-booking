import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { sameColor, suggestColor } from '../../lib/color'
import { errorMessage } from '../../lib/errors'
import { describeOpeningHours, openingHoursProblem, permissionLabels } from '../../services/bookingRules'
import { type AdminOrganization, type AdminRoom, adminApi, type RoomFields, type RoomStatus, roomStatusLabels } from '../../services/adminApi'
import type { Permission } from '../../types'
import { PermissionBadge, RoomDot } from '../booking/badges'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert, Field, Input, Select, Textarea } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { Chip } from './Chip'
import { ColorPicker } from './ColorPicker'
import { FutureBookingsDialog } from './FutureBookingsDialog'
import { OpeningHoursEditor } from './OpeningHoursEditor'
import { RoomAccessDialog } from './RoomAccessDialog'
import { useAdminData } from './useAdminData'

const PERMISSIONS: Permission[] = ['DIRECT', 'REQUEST', 'NONE']

/** System administrators: create and edit rooms, and set each organization's booking permission. */
export function RoomsAdmin() {
  const app = useApp()
  const load = useCallback(() => Promise.all([adminApi.rooms(), adminApi.organizations()]), [])
  const { data, error, reload } = useAdminData(load)
  const [editing, setEditing] = useState<AdminRoom | 'new' | null>(null)
  const [editingAccess, setEditingAccess] = useState<AdminRoom | null>(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <p className="text-sm text-slate-500">Laster rom …</p>
  const [rooms, allOrganizations] = data
  const organizations = allOrganizations.filter((o) => o.status === 'ACTIVE')
  const changed = () => {
    reload()
    app.reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> Nytt rom
        </Button>
      </div>

      {rooms.length === 0 && <p className="text-sm text-slate-500">Ingen rom ennå. Opprett det første rommet.</p>}

      {rooms.map((room) => (
        <section key={room.id} className="rounded-xl ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <RoomDot color={room.color} />
            <div className="min-w-48 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-slate-900">
                {room.name}
                {room.status !== 'ACTIVE' && <Chip label={roomStatusLabels[room.status]} tone="amber" />}
                {room.publicRequestable && <Chip label="I søknadsskjemaet" />}
                {room.hiddenWithoutAccess && <Chip label="Skjult uten tilgang" />}
              </p>
              <p className="text-xs text-slate-500">
                {[
                  room.capacity ? `${room.capacity} plasser` : null,
                  room.location,
                  room.openingHours.length > 0 ? `Åpent ${describeOpeningHours(room.openingHours)}` : null,
                  `Forvaltes av ${room.managingOrganizationId ? (allOrganizations.find((o) => o.id === room.managingOrganizationId)?.name ?? 'ukjent') : 'VT'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Button size="sm" onClick={() => setEditingAccess(room)} aria-label={`Tilganger for ${room.name}`}>
              <KeyRound className="size-4" /> Tilganger
            </Button>
            <Button size="sm" onClick={() => setEditing(room)} aria-label={`Rediger ${room.name}`}>
              <Pencil className="size-4" /> Rediger
            </Button>
          </div>
          <AccessSummary room={room} organizations={organizations} onOpen={() => setEditingAccess(room)} />
        </section>
      ))}

      {editingAccess && (
        <RoomAccessDialog
          room={editingAccess}
          organizations={organizations}
          onClose={() => setEditingAccess(null)}
          onSaved={() => {
            setEditingAccess(null)
            changed()
          }}
          onPartiallySaved={changed}
        />
      )}
      {editing && (
        <RoomDialog
          room={editing === 'new' ? null : editing}
          rooms={rooms}
          organizations={allOrganizations}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            changed()
          }}
        />
      )}
    </div>
  )
}

/** The organizations grouped by their effective permission for the room. */
function AccessSummary({ room, organizations, onOpen }: { room: AdminRoom; organizations: AdminOrganization[]; onOpen: () => void }) {
  if (organizations.length === 0) return null
  const effective = (org: AdminOrganization) => room.access.find((a) => a.organizationId === org.id)?.permission ?? room.defaultPermission
  return (
    <button type="button" onClick={onOpen} className="block w-full space-y-1.5 px-4 py-3 text-left hover:bg-slate-50">
      {PERMISSIONS.map((p) => {
        const orgs = organizations.filter((o) => effective(o) === p)
        if (orgs.length === 0) return null
        return (
          <div key={p} className="flex items-baseline gap-2 text-sm">
            <span className="w-20 shrink-0">
              <PermissionBadge permission={p} short />
            </span>
            <span className="min-w-0 text-slate-700">{orgs.map((o) => o.name).join(', ')}</span>
          </div>
        )
      })}
    </button>
  )
}

function RoomDialog({
  room,
  rooms,
  organizations,
  onClose,
  onSaved,
}: {
  room: AdminRoom | null
  rooms: AdminRoom[]
  organizations: AdminOrganization[]
  onClose: () => void
  onSaved: () => void
}) {
  const id = useId()
  // Archived rooms are no longer shown in the calendar, so their colors count as free.
  const others = rooms.filter((r) => r.id !== room?.id && r.status !== 'ARCHIVED')
  const [fields, setFields] = useState<RoomFields>(
    () =>
      room ?? {
        name: '',
        description: '',
        location: '',
        capacity: null,
        color: suggestColor(others.map((r) => r.color)),
        defaultPermission: 'REQUEST',
        publicRequestable: false,
        openingHours: [],
        managingOrganizationId: null,
        hiddenWithoutAccess: false,
      },
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmClosing, setConfirmClosing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (patch: Partial<RoomFields>) => setFields((f) => ({ ...f, ...patch }))
  // A room with bookings must be archived (and saved) before it can be deleted.
  const deletable = !!room && (room.bookingCount === 0 || room.status === 'ARCHIVED')
  // Closing or archiving the room: the administrator decides what happens to its future bookings first.
  const closing = !!room && fields.status !== room.status && (fields.status === 'DISABLED' || fields.status === 'ARCHIVED')

  const hoursProblem = openingHoursProblem(fields.openingHours)

  const save = async () => {
    if (hoursProblem) {
      setError(hoursProblem)
      return
    }
    if (closing) {
      setConfirmClosing(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (room) await adminApi.updateRoom(room.id, fields)
      else await adminApi.createRoom(fields)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  if (room && confirmClosing) {
    const archiving = fields.status === 'ARCHIVED'
    return (
      <FutureBookingsDialog
        title={archiving ? `Arkivere ${room.name}?` : `Stenge ${room.name}?`}
        intro={
          archiving
            ? 'Et arkivert rom vises ikke lenger og kan ikke bookes. Bookinger som beholdes, vises fortsatt, men kan bare få ny tittel eller kanselleres.'
            : 'Et stengt rom vises, men kan ikke bookes eller få nye søknader.'
        }
        load={() => adminApi.futureBookings('rooms', room.id)}
        onClose={() => setConfirmClosing(false)}
        onConfirm={async (cancelFutureBookings) => {
          await adminApi.updateRoom(room.id, { ...fields, cancelFutureBookings })
          onSaved()
        }}
      />
    )
  }

  if (room && confirmDelete) {
    return (
      <ConfirmDialog
        title={`Slette ${room.name}?`}
        confirmLabel="Slett rom"
        destructive
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await adminApi.deleteRoom(room.id)
            onSaved()
          } catch (err) {
            setError(errorMessage(err))
            setConfirmDelete(false)
          }
        }}
      >
        {room.bookingCount === 0
          ? 'Rommet og tilgangsinnstillingene slettes for godt.'
          : `Rommet, tilgangsinnstillingene og alle ${room.bookingCount} bookinger i det, også tidligere bookinger, slettes for godt. Dette kan ikke angres.`}
      </ConfirmDialog>
    )
  }

  return (
    <Modal
      title={room ? `Rediger ${room.name}` : 'Nytt rom'}
      onClose={onClose}
      footer={
        <>
          {deletable && (
            <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Slett
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !fields.name.trim()}>
            {room ? 'Lagre' : 'Opprett rom'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Navn" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={fields.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Beskrivelse" htmlFor={`${id}-desc`}>
          <Textarea id={`${id}-desc`} rows={2} maxLength={1000} value={fields.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plassering" htmlFor={`${id}-loc`}>
            <Input id={`${id}-loc`} value={fields.location ?? ''} maxLength={120} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          <Field label="Kapasitet" htmlFor={`${id}-cap`}>
            <Input
              id={`${id}-cap`}
              type="number"
              min={1}
              value={fields.capacity ?? ''}
              onChange={(e) => set({ capacity: e.target.value ? Number(e.target.value) : null })}
            />
          </Field>
        </div>
        <ColorPicker
          id={`${id}-color`}
          value={fields.color}
          onChange={(color) => set({ color })}
          usedBy={(color) => others.filter((r) => sameColor(r.color, color)).map((r) => r.name)}
        />
        {/* The default permission is chosen once, when the room is created; after that access is edited per organization under Tilganger. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {!room && (
            <Field label="Standardtilgang" htmlFor={`${id}-perm`} hint="Tilgangen alle organisasjoner får i rommet, også de som opprettes senere. Endres per organisasjon under Tilganger.">
              <Select id={`${id}-perm`} value={fields.defaultPermission} onChange={(e) => set({ defaultPermission: e.target.value as Permission })}>
                {PERMISSIONS.map((p) => (
                  <option key={p} value={p}>
                    {permissionLabels[p]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {room && (
            <Field
              label="Status"
              htmlFor={`${id}-status`}
              hint={
                deletable
                  ? 'Stengte rom vises, men kan ikke bookes.'
                  : 'Stengte rom vises, men kan ikke bookes. Rom med bookinger må arkiveres før de kan slettes.'
              }
            >
              <Select id={`${id}-status`} value={fields.status} onChange={(e) => set({ status: e.target.value as RoomStatus })}>
                {(Object.keys(roomStatusLabels) as RoomStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {roomStatusLabels[s]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {room && <RoomLifecycleHelp bookingCount={room.bookingCount} />}
        <Field
          label="Forvaltes av"
          htmlFor={`${id}-manager`}
          hint="Organisasjonsadministratorene i organisasjonen ser, godkjenner og avslår søknadene for rommet, i tillegg til systemadministratorer. Bare systemadministratorer endrer rommet og tilgangene."
        >
          <Select
            id={`${id}-manager`}
            value={fields.managingOrganizationId ?? ''}
            onChange={(e) => set({ managingOrganizationId: e.target.value || null })}
          >
            <option value="">VT (systemadministratorer)</option>
            {organizations
              .filter((o) => o.status === 'ACTIVE' || o.id === room?.managingOrganizationId)
              .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.status === 'ARCHIVED' ? ' (arkivert)' : ''}
                </option>
              ))}
          </Select>
        </Field>
        <OpeningHoursEditor value={fields.openingHours} onChange={(openingHours) => set({ openingHours })} />
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={fields.hiddenWithoutAccess}
              onChange={(e) => set({ hiddenWithoutAccess: e.target.checked })}
            />
            Skjul rommet for de uten tilgang
          </label>
          <p className="text-xs text-slate-500">
            Rommet og bookingene i det vises bare for medlemmer av organisasjoner som kan booke det (tilgang annet enn «Ingen»
            under Tilganger), for den som forvalter rommet og for systemadministratorer. Gjelder ikke søknadsskjemaet.
          </p>
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={fields.publicRequestable} onChange={(e) => set({ publicRequestable: e.target.checked })} />
            Kan forespørres fra søknadsskjemaet
          </label>
          <p className="text-xs text-slate-500">
            Rommet vises i det offentlige skjemaet på /soknad, med navn, kapasitet, beskrivelse og åpningstider. Beskrivelsen
            vises der, så skriv den for søkerne (f.eks. hvem som prioriteres).
          </p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}

/** What closing, archiving and deleting a room do to its bookings, in the room dialog. */
function RoomLifecycleHelp({ bookingCount }: { bookingCount: number }) {
  return (
    <details className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200 ring-inset">
      <summary className="cursor-pointer font-medium text-slate-700">Hva skjer med bookingene om jeg stenger, arkiverer eller sletter?</summary>
      <dl className="mt-2 space-y-2">
        <div>
          <dt className="font-medium text-slate-800">Stenge</dt>
          <dd>
            Rommet vises fortsatt, men kan ikke bookes eller få nye søknader. Du velger om fremtidige bookinger og søknader skal
            kanselleres eller beholdes. Ingenting slettes, og rommet kan åpnes igjen.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-800">Arkivere</dt>
          <dd>
            Rommet skjules og kan ikke bookes. Du velger om fremtidige bookinger skal kanselleres. De som beholdes, og alle tidligere
            bookinger, vises fortsatt, men kan bare få ny tittel eller beskrivelse eller kanselleres. Ingenting slettes.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-800">Slette</dt>
          <dd>
            Fjerner rommet og tilgangene for godt.{' '}
            {bookingCount === 0
              ? 'Rommet har aldri hatt bookinger, så det kan slettes direkte.'
              : `Rommet har ${bookingCount} ${bookingCount === 1 ? 'booking' : 'bookinger'}, så det må arkiveres først. Da slettes alle bookingene med det, også tidligere, og forespørsler som var booket i rommet, går tilbake til «Under arbeid». Det kan ikke angres.`}
          </dd>
        </div>
      </dl>
    </details>
  )
}
