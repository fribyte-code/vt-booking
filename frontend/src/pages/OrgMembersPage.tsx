import { MailX, ShieldAlert, Trash2, UserPlus } from 'lucide-react'
import { type FormEvent, useCallback, useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Chip } from '../components/admin/Chip'
import { TemporaryPasswordDialog } from '../components/admin/TemporaryPasswordDialog'
import { useAdminData } from '../components/admin/useAdminData'
import { EmptyState } from '../components/booking/BookingListItem'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Alert, Field, Input, Select } from '../components/ui/fields'
import { useApp } from '../hooks/useApp'
import { formatDateTime } from '../lib/dates'
import { errorMessage } from '../lib/errors'
import { type Member, type MembershipRole, membersApi, type OrgInvitation, roleLabels } from '../services/adminApi'

/**
 * Members of an organization, for its ORG_ADMINs (and system administrators).
 * Org admins add members, appoint other org admins and remove members. They cannot reset
 * passwords or change anyone's account; that is for system administrators.
 */
export function OrgMembersPage() {
  const app = useApp()
  const [params, setParams] = useSearchParams()
  const isSystemAdmin = app.currentUser.role === 'ADMIN'
  const manageable = isSystemAdmin
    ? app.data.organizations
    : app.data.organizations.filter((o) => app.currentUser.orgAdminOrganizationIds?.includes(o.id))
  const orgId = manageable.some((o) => o.id === params.get('org')) ? params.get('org')! : manageable[0]?.id

  if (!orgId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<ShieldAlert />} title="Ingen organisasjoner å administrere">
          Denne siden er for organisasjonsadministratorer.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Medlemmer</h1>
            <p className="mt-1 text-sm text-slate-500">Legg til medlemmer og bestem hvem som kan administrere organisasjonen.</p>
          </div>
          {manageable.length > 1 && (
            <Select
              aria-label="Organisasjon"
              className="w-auto!"
              value={orgId}
              onChange={(e) => setParams({ org: e.target.value })}
            >
              {manageable.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <Members key={orgId} orgId={orgId} orgName={manageable.find((o) => o.id === orgId)?.name ?? ''} isSystemAdmin={isSystemAdmin} />
      </div>
    </div>
  )
}

function Members({ orgId, orgName, isSystemAdmin }: { orgId: string; orgName: string; isSystemAdmin: boolean }) {
  const app = useApp()
  const id = useId()
  const load = useCallback(() => Promise.all([membersApi.list(orgId), membersApi.invitations(orgId)]), [orgId])
  const { data, error, reload } = useAdminData(load)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<MembershipRole>('MEMBER')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [shown, setShown] = useState<{ name: string; email: string; password: string } | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [withdrawing, setWithdrawing] = useState<OrgInvitation | null>(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <p className="text-sm text-slate-500">Laster medlemmer …</p>
  const [members, invitations] = data

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

  const add = async (e: FormEvent) => {
    e.preventDefault()
    await run(async () => {
      const result = await membersApi.add(orgId, { email, displayName: name, role })
      if (result.result === 'INVITED') {
        app.notify('Invitasjon sendt. Personen må godta den når de logger inn.')
      } else if (result.temporaryPassword) {
        setShown({ name: result.member.displayName, email: result.member.email, password: result.temporaryPassword })
      } else {
        app.notify(`${result.member.displayName} er lagt til i ${orgName}.`)
      }
      setEmail('')
      setName('')
      setRole('MEMBER')
    })
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="space-y-3 rounded-xl p-4 ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">Legg til medlem</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="E-post" htmlFor={`${id}-email`}>
            <Input id={`${id}-email`} type="email" required value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Navn" htmlFor={`${id}-name`} hint="Trengs bare for nye brukere.">
            <Input id={`${id}-name`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Rolle" htmlFor={`${id}-role`}>
            <Select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as MembershipRole)}>
              <option value="MEMBER">{roleLabels.MEMBER}</option>
              <option value="ORG_ADMIN">{roleLabels.ORG_ADMIN}</option>
            </Select>
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          {isSystemAdmin
            ? 'Har personen allerede en bruker, blir hen lagt til med en gang.'
            : 'Har personen allerede en bruker, får hen en invitasjon som må godtas ved neste innlogging.'}{' '}
          Ellers opprettes en ny bruker med et midlertidig passord som du gir videre.
        </p>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
            <UserPlus className="size-4" /> Legg til
          </Button>
        </div>
      </form>

      {actionError && <Alert tone="error">{actionError}</Alert>}

      <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                {m.displayName}
                {m.userId === app.currentUser.id && <Chip label="Deg" />}
                {m.status === 'DISABLED' && <Chip label="Deaktivert" tone="red" />}
              </p>
              <p className="truncate text-xs text-slate-500">{m.email}</p>
            </div>
            <Select
              aria-label={`Rolle for ${m.displayName}`}
              className="h-8! w-auto!"
              value={m.role}
              disabled={busy}
              onChange={(e) => run(() => membersApi.setRole(orgId, m.userId, e.target.value as MembershipRole))}
            >
              <option value="MEMBER">{roleLabels.MEMBER}</option>
              <option value="ORG_ADMIN">{roleLabels.ORG_ADMIN}</option>
            </Select>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setRemoving(m)} aria-label={`Fjern ${m.displayName}`}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>

      {invitations.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Ventende invitasjoner</h2>
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    <span className="truncate">{inv.email}</span>
                    <Chip label={roleLabels[inv.role]} />
                  </p>
                  <p className="text-xs text-slate-500">
                    Invitert {formatDateTime(inv.createdAt)}
                    {inv.invitedByName && ` av ${inv.invitedByName}`}
                  </p>
                </div>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => setWithdrawing(inv)}>
                  <MailX className="size-4" /> Trekk tilbake
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {withdrawing && (
        <ConfirmDialog
          title="Trekke tilbake invitasjonen?"
          confirmLabel="Trekk tilbake"
          destructive
          onClose={() => setWithdrawing(null)}
          onConfirm={async () => {
            await run(() => membersApi.withdrawInvitation(orgId, withdrawing.id))
            setWithdrawing(null)
          }}
        >
          {withdrawing.email} blir ikke medlem av {orgName}. Du kan invitere på nytt senere.
        </ConfirmDialog>
      )}
      {removing && (
        <ConfirmDialog
          title="Fjerne medlem?"
          confirmLabel="Fjern"
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await run(() => membersApi.remove(orgId, removing.userId))
            setRemoving(null)
          }}
        >
          {removing.displayName} mister tilgangen til å booke for {orgName}. Ventende søknader hen har sendt for {orgName}, trekkes
          tilbake. Godkjente bookinger og brukeren beholdes.
        </ConfirmDialog>
      )}
      {shown && <TemporaryPasswordDialog {...shown} onClose={() => setShown(null)} />}
    </div>
  )
}
