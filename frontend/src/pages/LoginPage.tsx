import { CalendarRange } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Alert, Field, Input } from '../components/ui/fields'
import { errorMessage } from '../lib/errors'

/**
 * Login with email and password. Accounts are created by administrators
 * (the first one with the backend's bootstrap-admin command); there is no sign-up.
 */
export function LoginPage({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onLogin(email.trim(), password)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-slate-900 text-white">
            <CalendarRange className="size-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold text-slate-900">Rombooking</span>
            <span className="block text-xs text-slate-500">Velferdstinget Vest</span>
          </span>
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Logg inn</h1>
        <Field label="E-post" htmlFor={`${id}-email`}>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Passord" htmlFor={`${id}-password`}>
          <Input
            id={`${id}-password`}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? 'Logger inn …' : 'Logg inn'}
        </Button>
      </form>
    </main>
  )
}
