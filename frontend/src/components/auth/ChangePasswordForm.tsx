import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { Button } from '../ui/Button'
import { Alert, Field, Input } from '../ui/fields'

/** Minimum length, matching the server's password policy. */
export const MIN_PASSWORD_LENGTH = 8

/** Current password, new password twice. The server enforces the real rules; this only catches typos early. */
export function ChangePasswordForm({
  onSubmit,
  submitLabel,
  extraActions,
}: {
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>
  submitLabel: string
  extraActions?: ReactNode
}) {
  const id = useId()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if ([...next].length < MIN_PASSWORD_LENGTH) return setError(`Det nye passordet må ha minst ${MIN_PASSWORD_LENGTH} tegn.`)
    if (next !== repeat) return setError('De nye passordene er ikke like.')
    setBusy(true)
    setError(null)
    try {
      await onSubmit(current, next)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nåværende passord" htmlFor={`${id}-current`}>
        <Input id={`${id}-current`} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="Nytt passord" htmlFor={`${id}-new`} hint={`Minst ${MIN_PASSWORD_LENGTH} tegn.`}>
        <Input id={`${id}-new`} type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Gjenta nytt passord" htmlFor={`${id}-repeat`}>
        <Input id={`${id}-repeat`} type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        {extraActions}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Lagrer …' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
