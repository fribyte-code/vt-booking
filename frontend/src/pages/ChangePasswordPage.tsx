import { CalendarRange } from 'lucide-react'
import { ChangePasswordForm } from '../components/auth/ChangePasswordForm'
import { Button } from '../components/ui/Button'

/** Shown instead of the app after logging in with a temporary password. */
export function ChangePasswordPage({
  onChange,
  onLogout,
}: {
  onChange: (currentPassword: string, newPassword: string) => Promise<void>
  onLogout: () => void
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-slate-900 text-white">
            <CalendarRange className="size-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold text-slate-900">Rombooking</span>
            <span className="block text-xs text-slate-500">Velferdstinget Vest</span>
          </span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Velg nytt passord</h1>
          <p className="mt-1 text-sm text-slate-500">
            Du logget inn med et midlertidig passord. Velg ditt eget passord for å fortsette.
          </p>
        </div>
        <ChangePasswordForm
          onSubmit={onChange}
          submitLabel="Lagre og fortsett"
          extraActions={
            <Button variant="ghost" onClick={onLogout}>
              Logg ut
            </Button>
          }
        />
      </div>
    </main>
  )
}
