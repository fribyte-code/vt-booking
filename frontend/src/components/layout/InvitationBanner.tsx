import { Check, MailPlus, X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { errorMessage } from '../../lib/errors'
import type { Invitation } from '../../types'
import { Button } from '../ui/Button'

const roleText = (inv: Invitation) => (inv.role === 'ORG_ADMIN' ? ' som organisasjonsadministrator' : '')

/** Accept and decline buttons for one invitation. Accepting reloads the data, so the organization appears. */
export function InvitationActions({ invitation, onDone }: { invitation: Invitation; onDone?: () => void }) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  if (!app.acceptInvitation || !app.declineInvitation) return null
  const { acceptInvitation, declineInvitation } = app

  const answer = async (accept: boolean) => {
    setBusy(true)
    try {
      if (accept) {
        await acceptInvitation(invitation.id)
        app.notify(`Du er nå medlem av ${invitation.organizationName}.`)
      } else {
        await declineInvitation(invitation.id)
        app.notify(`Invitasjonen fra ${invitation.organizationName} er avslått.`, 'info')
      }
      onDone?.()
    } catch (err) {
      app.notify(errorMessage(err), 'error')
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" onClick={() => answer(false)} disabled={busy}>
        <X className="size-4" /> Avslå
      </Button>
      <Button size="sm" variant="primary" onClick={() => answer(true)} disabled={busy}>
        <Check className="size-4" /> Godta
      </Button>
    </div>
  )
}

export function InvitationText({ invitation: inv }: { invitation: Invitation }) {
  return (
    <>
      {inv.invitedByName ?? 'En administrator'} har invitert deg til{' '}
      <span className="font-medium">{inv.organizationName}</span>
      {roleText(inv)}.
    </>
  )
}

/** API mode: pending invitations, shown above every page until they are answered. */
export function InvitationBanner() {
  const app = useApp()
  const invitations = app.data.invitations ?? []
  if (invitations.length === 0 || !app.acceptInvitation) return null

  return (
    <div className="shrink-0 space-y-2 border-b border-blue-100 bg-blue-50 px-3 py-2.5 sm:px-4">
      {invitations.map((inv) => (
        <div key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <MailPlus className="size-4 shrink-0 text-blue-700" />
          <p className="min-w-0 flex-1 text-sm text-blue-950">
            <InvitationText invitation={inv} />
          </p>
          <InvitationActions invitation={inv} />
        </div>
      ))}
    </div>
  )
}
