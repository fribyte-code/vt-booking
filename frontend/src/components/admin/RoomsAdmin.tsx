import { Pencil, Plus } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { errorMessage } from '../../lib/errors'
import { permissionLabels } from '../../services/bookingRules'
import { type AdminOrganization, type AdminRoom, adminApi, type RoomFields, type RoomStatus, roomStatusLabels } from '../../services/adminApi'
import type { Permission } from '../../types'
import { RoomDot } from '../booking/badges'
import { Button } from '../ui/Button'
import { Alert, Field, Input, Select, Textarea } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { Chip } from './Chip'
import { useAdminData } from './useAdminData'

const PERMISSIONS: Permission[] = ['DIRECT', 'REQUEST', 'NONE']

/** System administrators: create and edit rooms, and set each organization's booking permission. */
export function RoomsAdmin() {
  const app = useApp()
  const load = useCallback(() => Promise.all([adminApi.rooms(), adminApi.organizations()]), [])
  const { data, error, reload } = useAdminData(load)
  const [editing, setEditing] = useState<AdminRoom | 'new' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <p className="text-sm text-slate-500">Laster rom …</p>
  const [rooms, allOrganizations] = data
  const organizations = allOrganizations.filter((o) => o.status === 'ACTIVE')
  const changed = () => {
    reload()
    app.reload()
  }

  const setAccess = async (room: AdminRoom, org: AdminOrganization, value: string) => {
    setActionError(null)
    try {
      await adminApi.setRoomAccess(room.id, org.id, value === 'DEFAULT' ? null : (value as Permission))
      changed()
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> Nytt rom
        </Button>
      </div>
      {actionError && <Alert tone="error">{actionError}</Alert>}

      {rooms.length === 0 && <p className="text-sm text-slate-500">Ingen rom ennå. Opprett det første rommet.</p>}

      {rooms.map((room) => (
        <section key={room.id} className="rounded-xl ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <RoomDot color={room.color} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                {room.name}
                {room.status !== 'ACTIVE' && <Chip label={roomStatusLabels[room.status]} tone="amber" />}
              </p>
              <p className="text-xs text-slate-500">
                {[room.capacity ? `${room.capacity} plasser` : null, room.location, `Standard: ${permissionLabels[room.defaultPermission]}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Button size="sm" onClick={() => setEditing(room)} aria-label={`Rediger ${room.name}`}>
              <Pencil className="size-4" /> Rediger
            </Button>
          </div>
          {organizations.length > 0 && (
            <div className="grid gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-2">
              {organizations.map((org) => {
                const override = room.access.find((a) => a.organizationId === org.id)?.permission
                return (
                  <label key={org.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate text-slate-700">{org.name}</span>
                    <Select
                      className="h-8! w-48! shrink-0"
                      aria-label={`Tilgang for ${org.name} til ${room.name}`}
                      value={override ?? 'DEFAULT'}
                      onChange={(e) => setAccess(room, org, e.target.value)}
                    >
                      <option value="DEFAULT">Standard ({permissionLabels[room.defaultPermission]})</option>
                      {PERMISSIONS.map((p) => (
                        <option key={p} value={p}>
                          {permissionLabels[p]}
                        </option>
                      ))}
                    </Select>
                  </label>
                )
              })}
            </div>
          )}
        </section>
      ))}

      {editing && (
        <RoomDialog
          room={editing === 'new' ? null : editing}
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

function RoomDialog({ room, onClose, onSaved }: { room: AdminRoom | null; onClose: () => void; onSaved: () => void }) {
  const id = useId()
  const [fields, setFields] = useState<RoomFields>(
    room ?? { name: '', description: '', location: '', capacity: null, color: '#2563eb', defaultPermission: 'REQUEST' },
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<RoomFields>) => setFields((f) => ({ ...f, ...patch }))

  const save = async () => {
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

  return (
    <Modal
      title={room ? `Rediger ${room.name}` : 'Nytt rom'}
      onClose={onClose}
      footer={
        <>
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
        <div className="grid gap-4 sm:grid-cols-3">
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
          <Field label="Farge" htmlFor={`${id}-color`}>
            <Input id={`${id}-color`} type="color" className="px-1" value={fields.color} onChange={(e) => set({ color: e.target.value })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Standardtilgang" htmlFor={`${id}-perm`} hint="Gjelder organisasjoner uten egen innstilling.">
            <Select id={`${id}-perm`} value={fields.defaultPermission} onChange={(e) => set({ defaultPermission: e.target.value as Permission })}>
              {PERMISSIONS.map((p) => (
                <option key={p} value={p}>
                  {permissionLabels[p]}
                </option>
              ))}
            </Select>
          </Field>
          {room && (
            <Field label="Status" htmlFor={`${id}-status`} hint="Stengte rom vises, men kan ikke bookes.">
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
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
