import { Archive, ArchiveRestore, Pencil, Plus, Users } from 'lucide-react'
import { type FormEvent, useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../hooks/useApp'
import { errorMessage } from '../../lib/errors'
import { type AdminOrganization, adminApi } from '../../services/adminApi'
import { Button } from '../ui/Button'
import { Alert, Field, Input } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { Chip } from './Chip'
import { FutureBookingsDialog } from './FutureBookingsDialog'
import { useAdminData } from './useAdminData'

/** System administrators: create, rename, archive and restore organizations. */
export function OrganizationsAdmin() {
  const app = useApp()
  const load = useCallback(() => adminApi.organizations(), [])
  const { data: organizations, error, reload } = useAdminData(load)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<AdminOrganization | null>(null)
  const [archiving, setArchiving] = useState<AdminOrganization | null>(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!organizations) return <p className="text-sm text-slate-500">Laster organisasjoner …</p>

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      reload()
      app.reload()
      return true
    } catch (err) {
      setActionError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(() => adminApi.createOrganization(name))) setName('')
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder="Navn på ny organisasjon"
          aria-label="Navn på ny organisasjon"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          <Plus className="size-4" /> Opprett
        </Button>
      </form>
      {actionError && <Alert tone="error">{actionError}</Alert>}

      <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
        {organizations.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                {o.name} {o.status === 'ARCHIVED' && <Chip label="Arkivert" tone="amber" />}
              </p>
              <p className="text-xs text-slate-500">
                {o.memberCount} {o.memberCount === 1 ? 'medlem' : 'medlemmer'}
              </p>
            </div>
            {o.status === 'ACTIVE' && (
              <Link
                to={`/medlemmer?org=${o.id}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50"
              >
                <Users className="size-4" /> Medlemmer
              </Link>
            )}
            <Button size="sm" onClick={() => setRenaming(o)} aria-label={`Gi nytt navn til ${o.name}`}>
              <Pencil className="size-4" />
            </Button>
            {o.status === 'ACTIVE' ? (
              <Button size="sm" variant="danger" disabled={busy} onClick={() => setArchiving(o)}>
                <Archive className="size-4" /> Arkiver
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => run(() => adminApi.updateOrganization(o.id, { status: 'ACTIVE' }))}>
                <ArchiveRestore className="size-4" /> Gjenopprett
              </Button>
            )}
          </li>
        ))}
        {organizations.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Ingen organisasjoner ennå.</li>}
      </ul>
      <p className="text-xs text-slate-500">Arkiverte organisasjoner kan ikke booke rom. Du velger selv om kommende bookinger kanselleres; historikken beholdes.</p>

      {archiving && (
        <FutureBookingsDialog
          title={`Arkivere ${archiving.name}?`}
          intro={
            <>
              {archiving.name} kan ikke booke rom etter arkivering, og organisasjonsadministratorene kan ikke endre medlemmer.
              Invitasjoner som ikke er besvart, slettes.
            </>
          }
          load={() => adminApi.futureBookings('organizations', archiving.id)}
          onClose={() => setArchiving(null)}
          onConfirm={async (cancelFutureBookings) => {
            await adminApi.updateOrganization(archiving.id, { status: 'ARCHIVED', cancelFutureBookings })
            setArchiving(null)
            reload()
            app.reload()
            app.notify(`${archiving.name} er arkivert.`, 'info')
          }}
        />
      )}
      {renaming && (
        <RenameDialog
          organization={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (newName) => {
            await adminApi.updateOrganization(renaming.id, { name: newName })
            setRenaming(null)
            reload()
            app.reload()
          }}
        />
      )}
    </div>
  )
}

function RenameDialog({ organization, onClose, onSave }: { organization: AdminOrganization; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(organization.name)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    try {
      await onSave(name)
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <Modal
      title="Gi nytt navn"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={save} disabled={!name.trim()}>
            Lagre
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Navn" htmlFor="rename-org">
          <Input id="rename-org" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
