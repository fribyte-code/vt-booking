import { ChevronDown, KeyRound, LogOut } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { errorMessage } from '../../lib/errors'
import { ChangePasswordForm } from '../auth/ChangePasswordForm'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Popover } from '../ui/Popover'
import { Avatar } from './Avatar'

/** The signed-in user, with logout. */
export function AccountMenu() {
  const app = useApp()
  const { currentUser } = app
  const [busy, setBusy] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const description =
    currentUser.role === 'ADMIN'
      ? 'Systemadministrator'
      : currentUser.organizationIds.map((id) => app.organization(id)?.name).join(', ')

  return (
    <>
    <Popover
      className="w-72"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <Avatar user={currentUser} />
          <span className="hidden text-left leading-tight md:block">
            <span className="block text-sm font-medium text-slate-900">{currentUser.name}</span>
            <span className="block max-w-44 truncate text-xs text-slate-500">{description}</span>
          </span>
          <ChevronDown className="size-4 text-slate-500" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{currentUser.name}</p>
            <p className="truncate text-xs text-slate-500">{currentUser.email}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{description}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close()
              setChangingPassword(true)
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <KeyRound className="size-4" /> Bytt passord
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await app.logout()
              } catch (err) {
                app.notify(errorMessage(err), 'error')
                setBusy(false)
              }
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
          >
            <LogOut className="size-4" /> Logg ut
          </button>
        </div>
      )}
    </Popover>
    {changingPassword && (
      <Modal title="Bytt passord" onClose={() => setChangingPassword(false)} size="sm">
        <ChangePasswordForm
          submitLabel="Bytt passord"
          extraActions={
            <Button variant="ghost" onClick={() => setChangingPassword(false)}>
              Avbryt
            </Button>
          }
          onSubmit={async (currentPassword, newPassword) => {
            await app.changePassword(currentPassword, newPassword)
            setChangingPassword(false)
            app.notify('Passordet er byttet. Andre innlogginger er logget ut.')
          }}
        />
      </Modal>
    )}
    </>
  )
}
