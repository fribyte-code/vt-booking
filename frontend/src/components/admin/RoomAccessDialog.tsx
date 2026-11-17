import { Search } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '../../lib/cn'
import { errorMessage } from '../../lib/errors'
import { permissionLabels } from '../../services/bookingRules'
import { type AdminOrganization, type AdminRoom, adminApi } from '../../services/adminApi'
import type { Permission } from '../../types'
import { RoomDot } from '../booking/badges'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert, Input } from '../ui/fields'
import { Modal } from '../ui/Modal'

const PERMISSIONS: Permission[] = ['DIRECT', 'REQUEST', 'NONE']
const shortLabels: Record<Permission, string> = { DIRECT: 'Direkte', REQUEST: 'Søknad', NONE: 'Ingen' }

/** Above this many organizations the list gets a search field. */
const SEARCH_THRESHOLD = 8

/** Every active organization's permission for one room, edited together and saved at once. */
export function RoomAccessDialog({
  room,
  organizations,
  onClose,
  onSaved,
  onPartiallySaved,
}: {
  room: AdminRoom
  organizations: AdminOrganization[]
  onClose: () => void
  onSaved: () => void
  /** Some changes were saved before one failed; the dialog stays open. */
  onPartiallySaved: () => void
}) {
  const id = useId()
  // What applies now: the organization's own setting, or the default the room was created with.
  // The dialog shows only that; saving a change stores it for the organization.
  const initial = (orgId: string): Permission => room.access.find((a) => a.organizationId === orgId)?.permission ?? room.defaultPermission
  const [choices, setChoices] = useState<Record<string, Permission>>(() => Object.fromEntries(organizations.map((o) => [o.id, initial(o.id)])))
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const changedOrgs = organizations.filter((o) => choices[o.id] !== initial(o.id))
  const changeCount = changedOrgs.length
  const visible = organizations.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
  const setAll = (choice: Permission) => setChoices(Object.fromEntries(organizations.map((o) => [o.id, choice])))

  const close = () => (changeCount > 0 ? setConfirmDiscard(true) : onClose())

  const save = async () => {
    setBusy(true)
    setError(null)
    let saved = 0
    try {
      for (const org of changedOrgs) {
        await adminApi.setRoomAccess(room.id, org.id, choices[org.id])
        saved++
      }
      onSaved()
    } catch (err) {
      // Changes saved before the failure stay saved; every request sets an absolute value, so saving again is safe.
      setError(saved > 0 ? `${saved} av ${changeCount} endringer ble lagret. ${errorMessage(err)}` : errorMessage(err))
      setBusy(false)
      if (saved > 0) onPartiallySaved()
    }
  }

  if (confirmDiscard) {
    return (
      <ConfirmDialog title="Forkaste endringene?" confirmLabel="Forkast" destructive onClose={() => setConfirmDiscard(false)} onConfirm={onClose}>
        {changeCount === 1 ? 'Du har én endring som ikke er lagret.' : `Du har ${changeCount} endringer som ikke er lagret.`}
      </ConfirmDialog>
    )
  }

  return (
    <Modal
      title={`Tilganger for ${room.name}`}
      leading={<RoomDot color={room.color} />}
      size="lg"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || changeCount === 0}>
            {changeCount > 0 ? `Lagre ${changeCount} ${changeCount === 1 ? 'endring' : 'endringer'}` : 'Lagre'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {organizations.length === 0 ? (
          <p className="text-sm text-slate-500">Ingen aktive organisasjoner.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {organizations.length > SEARCH_THRESHOLD && (
                <div className="relative min-w-48 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                  <Input className="h-8! pl-9" placeholder="Søk etter organisasjon" aria-label="Søk etter organisasjon" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
              )}
              <span className="text-xs text-slate-500">Sett alle til:</span>
              {PERMISSIONS.map((p) => (
                <Button key={p} size="sm" variant="ghost" onClick={() => setAll(p)}>
                  {shortLabels[p]}
                </Button>
              ))}
            </div>

            <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
              {visible.map((org) => {
                const choice = choices[org.id]
                const changed = choice !== initial(org.id)
                return (
                  <li key={org.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{org.name}</p>
                      <p className="text-xs text-slate-500">
                        {permissionLabels[choice]}
                        {changed && <span className="ml-1.5 font-medium text-amber-700">· endret</span>}
                      </p>
                    </div>
                    <PermissionToggle name={`${id}-${org.id}`} label={`Tilgang for ${org.name}`} value={choice} onChange={(c) => setChoices((all) => ({ ...all, [org.id]: c }))} />
                  </li>
                )
              })}
              {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Ingen organisasjoner passer søket.</li>}
            </ul>
          </>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}

const selectedStyles: Record<Permission, string> = {
  DIRECT: 'bg-emerald-600 text-white shadow-sm',
  REQUEST: 'bg-amber-500 text-white shadow-sm',
  NONE: 'bg-slate-600 text-white shadow-sm',
}

function PermissionToggle({ name, label, value, onChange }: { name: string; label: string; value: Permission; onChange: (choice: Permission) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
      {PERMISSIONS.map((p) => {
        const checked = value === p
        return (
          <label
            key={p}
            title={permissionLabels[p]}
            className={cn(
              'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors has-focus-visible:ring-2 has-focus-visible:ring-slate-400',
              checked ? selectedStyles[p] : 'text-slate-600 hover:text-slate-900',
            )}
          >
            <input type="radio" className="sr-only" name={name} checked={checked} onChange={() => onChange(p)} />
            {shortLabels[p]}
          </label>
        )
      })}
    </div>
  )
}
