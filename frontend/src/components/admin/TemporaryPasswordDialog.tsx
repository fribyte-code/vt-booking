import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Alert } from '../ui/fields'
import { Modal } from '../ui/Modal'

/** Shows a server-generated temporary password once, with a copy button. It is never shown again. */
export function TemporaryPasswordDialog({ name, email, password, onClose }: { name: string; email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Modal
      title="Midlertidig passord"
      onClose={onClose}
      size="sm"
      footer={
        <Button variant="primary" onClick={onClose}>
          Ferdig
        </Button>
      }
    >
      <div className="space-y-4 text-sm text-slate-600">
        <p>
          Gi passordet til <span className="font-medium text-slate-900">{name}</span> ({email}) på en trygg måte. Brukeren må
          velge et nytt passord ved første innlogging.
        </p>
        <div className="flex items-center gap-2">
          <code data-testid="temporary-password" className="flex-1 rounded-lg bg-slate-100 px-3 py-2 font-mono text-base text-slate-900 select-all">
            {password}
          </code>
          <Button onClick={copy} aria-label="Kopier passord" data-autofocus>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Kopiert' : 'Kopier'}
          </Button>
        </div>
        <Alert tone="warning">Passordet vises bare nå. Lukker du vinduet, må du tilbakestille passordet for å få et nytt.</Alert>
      </div>
    </Modal>
  )
}
