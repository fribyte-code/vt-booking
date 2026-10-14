import { KeyRound, Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { formatDateTime } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { type AdminOrganization, type AdminUser, adminApi, type MembershipRole, roleLabels } from '../../services/adminApi'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert, Field, Input, Select } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { Chip } from './Chip'
import { FutureBookingsDialog } from './FutureBookingsDialog'
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog'
import { useAdminData } from './useAdminData'

interface Shown {
  name: string
  email: string
  password: string
}

/** System administrators: create users, edit them, reset passwords and manage memberships. */
export function UsersAdmin() {
  const app = useApp()
  const load = useCallback(() => Promise.all([adminApi.users(), adminApi.organizations()]), [])
  const { data, error, reload } = useAdminData(load)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [query, setQuery] = useState('')

  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <p className="text-sm text-slate-500">Laster brukere …</p>
  const [users, organizations] = data
  const orgName = (id: string) => organizations.find((o) => o.id === id)?.name ?? 'Ukjent'
  const changed = () => {
    reload()
    app.reload()
  }
  const q = query.trim().toLowerCase()
  const visible = users.filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  const editing = users.find((u) => u.id === editingId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Søk etter navn eller e-post"
          aria-label="Søk etter brukere"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex-1" />
        <Button variant="primary" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" /> Ny bruker
        </Button>
      </div>

      <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
        {visible.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                {u.displayName}
                {u.globalRole === 'SYSTEM_ADMIN' && <Chip label="Systemadministrator" tone="dark" />}
                {u.status === 'DISABLED' && <Chip label="Deaktivert" tone="red" />}
                {u.status === 'ACTIVE' && !u.hasPassword && <Chip label="Mangler passord" tone="amber" />}
                {u.mustChangePassword && <Chip label="Må bytte passord" tone="amber" />}
              </p>
              <p className="truncate text-xs text-slate-500">
                {u.email} · {u.lastLoginAt ? `Sist innlogget ${formatDateTime(u.lastLoginAt)}` : 'Aldri innlogget'}
              </p>
              {u.memberships.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {u.memberships.map((m) => (
                    <Chip key={m.organizationId} label={`${orgName(m.organizationId)}${m.role === 'ORG_ADMIN' ? ' (admin)' : ''}`} />
                  ))}
                </div>
              )}
            </div>
            <Button size="sm" onClick={() => setEditingId(u.id)} aria-label={`Rediger ${u.displayName}`}>
              <Pencil className="size-4" /> Rediger
            </Button>
          </li>
        ))}
        {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Ingen brukere funnet.</li>}
      </ul>

      {creating && (
        <CreateUserDialog
          organizations={organizations}
          onClose={() => setCreating(false)}
          onCreated={(user, password) => {
            setCreating(false)
            setShown({ name: user.displayName, email: user.email, password })
            changed()
          }}
        />
      )}
      {editing && (
        <EditUserDialog
          key={editing.id}
          user={editing}
          organizations={organizations}
          onClose={() => setEditingId(null)}
          onChanged={changed}
          onPasswordReset={(password) => {
            setEditingId(null)
            setShown({ name: editing.displayName, email: editing.email, password })
            changed()
          }}
        />
      )}
      {shown && <TemporaryPasswordDialog {...shown} onClose={() => setShown(null)} />}
    </div>
  )
}

function CreateUserDialog({
  organizations,
  onClose,
  onCreated,
}: {
  organizations: AdminOrganization[]
  onClose: () => void
  onCreated: (user: AdminUser, temporaryPassword: string) => void
}) {
  const id = useId()
  const active = organizations.filter((o) => o.status === 'ACTIVE')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [systemAdmin, setSystemAdmin] = useState(false)
  const [orgId, setOrgId] = useState('')
  const [role, setRole] = useState<MembershipRole>('MEMBER')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { user, temporaryPassword } = await adminApi.createUser({
        email,
        displayName: name,
        globalRole: systemAdmin ? 'SYSTEM_ADMIN' : 'USER',
        memberships: orgId ? [{ organizationId: orgId, role }] : [],
      })
      onCreated(user, temporaryPassword)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Ny bruker"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim() || !email.trim()}>
            Opprett bruker
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Navn" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="E-post" htmlFor={`${id}-email`} hint="Brukes til innlogging.">
          <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisasjon (valgfritt)" htmlFor={`${id}-org`}>
            <Select id={`${id}-org`} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="">Ingen</option>
              {active.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rolle i organisasjonen" htmlFor={`${id}-role`}>
            <Select id={`${id}-role`} value={role} disabled={!orgId} onChange={(e) => setRole(e.target.value as MembershipRole)}>
              <option value="MEMBER">{roleLabels.MEMBER}</option>
              <option value="ORG_ADMIN">{roleLabels.ORG_ADMIN}</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={systemAdmin} onChange={(e) => setSystemAdmin(e.target.checked)} />
          Systemadministrator (full tilgang til alt)
        </label>
        <p className="text-xs text-slate-500">Brukeren får et midlertidig passord, som vises én gang etter at brukeren er opprettet.</p>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}

function EditUserDialog({
  user,
  organizations,
  onClose,
  onChanged,
  onPasswordReset,
}: {
  user: AdminUser
  organizations: AdminOrganization[]
  onClose: () => void
  onChanged: () => void
  onPasswordReset: (temporaryPassword: string) => void
}) {
  const app = useApp()
  const id = useId()
  const isSelf = user.id === app.currentUser.id
  const [name, setName] = useState(user.displayName)
  const [email, setEmail] = useState(user.email)
  const [systemAdmin, setSystemAdmin] = useState(user.globalRole === 'SYSTEM_ADMIN')
  const [active, setActive] = useState(user.status === 'ACTIVE')
  const [addOrgId, setAddOrgId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [removingOrgId, setRemovingOrgId] = useState<string | null>(null)
  const orgName = (orgId: string) => organizations.find((o) => o.id === orgId)?.name ?? 'Ukjent'
  const addable = organizations.filter((o) => o.status === 'ACTIVE' && !user.memberships.some((m) => m.organizationId === o.id))

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
      after?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const fields = () => ({
    displayName: name,
    email,
    globalRole: systemAdmin ? ('SYSTEM_ADMIN' as const) : ('USER' as const),
    status: active ? ('ACTIVE' as const) : ('DISABLED' as const),
  })
  // Deactivating: the administrator first sees the user's future bookings and decides about the approved ones.
  const save = () =>
    user.status === 'ACTIVE' && !active ? setConfirmDisable(true) : run(() => adminApi.updateUser(user.id, fields()), onClose)

  return (
    <Modal
      title={`Rediger ${user.displayName}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {!isSelf && (
            <Button onClick={() => setConfirmReset(true)} disabled={busy} className="mr-auto">
              <KeyRound className="size-4" /> Tilbakestill passord
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            Lagre
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Navn" htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <Field label="E-post" htmlFor={`${id}-email`}>
            <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
          </Field>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={systemAdmin} disabled={isSelf} onChange={(e) => setSystemAdmin(e.target.checked)} />
            Systemadministrator
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={active} disabled={isSelf} onChange={(e) => setActive(e.target.checked)} />
            Aktiv (kan logge inn)
          </label>
          {isSelf && <p className="text-xs text-slate-500">Du kan ikke fjerne din egen administratortilgang eller deaktivere deg selv.</p>}
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Organisasjoner</h3>
          <p className="mb-2 text-xs text-slate-500">Endringer i medlemskap lagres med en gang.</p>
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {user.memberships.map((m) => (
              <li key={m.organizationId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="flex-1 text-sm text-slate-800">{orgName(m.organizationId)}</span>
                <Select
                  aria-label={`Rolle i ${orgName(m.organizationId)}`}
                  className="h-8! w-auto!"
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => run(() => adminApi.setMembership(user.id, m.organizationId, e.target.value as MembershipRole))}
                >
                  <option value="MEMBER">{roleLabels.MEMBER}</option>
                  <option value="ORG_ADMIN">{roleLabels.ORG_ADMIN}</option>
                </Select>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  aria-label={`Fjern fra ${orgName(m.organizationId)}`}
                  onClick={() => setRemovingOrgId(m.organizationId)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
            {user.memberships.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Ikke medlem av noen organisasjon.</li>}
          </ul>
          {addable.length > 0 && (
            <div className="mt-2 flex gap-2">
              <Select aria-label="Legg til i organisasjon" value={addOrgId} onChange={(e) => setAddOrgId(e.target.value)}>
                <option value="">Velg organisasjon …</option>
                {addable.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
              <Button
                disabled={!addOrgId || busy}
                onClick={() => run(() => adminApi.setMembership(user.id, addOrgId, 'MEMBER'), () => setAddOrgId(''))}
              >
                <Plus className="size-4" /> Legg til
              </Button>
            </div>
          )}
        </section>
        {error && <Alert tone="error">{error}</Alert>}
      </div>

      {confirmDisable && (
        <FutureBookingsDialog
          title={`Deaktivere ${user.displayName}?`}
          intro={`${user.displayName} kan ikke logge inn etter deaktivering, og blir logget ut overalt.`}
          load={() => adminApi.futureBookings('users', user.id)}
          choiceApplies={(b) => b.status === 'APPROVED'}
          alwaysCancelledNote="Ventende søknader trekkes alltid tilbake når en bruker deaktiveres. Valget gjelder bare godkjente bookinger."
          onClose={() => setConfirmDisable(false)}
          onConfirm={async (cancelFutureBookings) => {
            await adminApi.updateUser(user.id, { ...fields(), cancelFutureBookings })
            setConfirmDisable(false)
            onChanged()
            onClose()
          }}
        />
      )}
      {removingOrgId && (
        <ConfirmDialog
          title="Fjerne fra organisasjonen?"
          confirmLabel="Fjern"
          destructive
          onClose={() => setRemovingOrgId(null)}
          onConfirm={async () => {
            await run(() => adminApi.removeMembership(user.id, removingOrgId))
            setRemovingOrgId(null)
          }}
        >
          {user.displayName} mister tilgangen til å booke for {orgName(removingOrgId)}. Ventende søknader hen har sendt for{' '}
          {orgName(removingOrgId)}, trekkes tilbake. Godkjente bookinger beholdes.
        </ConfirmDialog>
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Tilbakestille passord?"
          confirmLabel="Tilbakestill"
          destructive
          onClose={() => setConfirmReset(false)}
          onConfirm={async () => {
            try {
              const { temporaryPassword } = await adminApi.resetPassword(user.id)
              setConfirmReset(false)
              onPasswordReset(temporaryPassword)
            } catch (err) {
              setConfirmReset(false)
              setError(errorMessage(err))
            }
          }}
        >
          {user.displayName} får et nytt midlertidig passord og blir logget ut overalt. Det gamle passordet slutter å virke.
        </ConfirmDialog>
      )}
    </Modal>
  )
}
