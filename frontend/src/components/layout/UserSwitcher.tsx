import { Check, ChevronDown, LogIn, ShieldCheck } from 'lucide-react'
import { LOGIN_URL } from '../../config'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'
import type { User } from '../../types'
import { Popover } from '../ui/Popover'
import { Avatar } from './Avatar'

/** Demo mode only: switches the simulated logged-in user. */
export function UserSwitcher() {
  const app = useApp()
  const { currentUser, data } = app

  const describe = (user: User) =>
    user.role === 'ADMIN'
      ? 'Administrator'
      : user.organizationIds.map((id) => app.organization(id)?.name).join(', ')

  return (
    <Popover
      className="w-80"
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
            <span className="block max-w-44 truncate text-xs text-slate-500">{describe(currentUser)}</span>
          </span>
          <ChevronDown className="size-4 text-slate-500" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Bytt demobruker</p>
            <p className="text-xs text-slate-500">Innlogging er simulert i denne prototypen.</p>
          </div>
          <ul className="py-1">
            {data.users.map((user) => {
              const active = user.id === currentUser.id
              return (
                <li key={user.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      if (!active) {
                        app.setCurrentUserId(user.id)
                        app.notify(`Du er nå logget inn som ${user.name}.`, 'info')
                      }
                      close()
                    }}
                    className={cn('flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50', active && 'bg-slate-50')}
                  >
                    <Avatar user={user} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                        {user.name}
                        {user.role === 'ADMIN' && <ShieldCheck className="size-3.5 text-slate-500" />}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{describe(user)}</span>
                    </span>
                    {active && <Check className="size-4 text-blue-600" />}
                  </button>
                </li>
              )
            })}
          </ul>
          {LOGIN_URL && (
            <a
              href={LOGIN_URL}
              className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <LogIn className="size-4" /> Avslutt demo og gå til innlogging
            </a>
          )}
        </div>
      )}
    </Popover>
  )
}
