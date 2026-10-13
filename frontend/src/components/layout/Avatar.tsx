import { cn } from '../../lib/cn'
import type { User } from '../../types'

const avatarColors = ['bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600', 'bg-indigo-600']

export function Avatar({ user, className }: { user: User; className?: string }) {
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
  const index = [...user.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % avatarColors.length
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
        user.role === 'ADMIN' ? 'bg-slate-800' : avatarColors[index],
        className,
      )}
    >
      {initials}
    </span>
  )
}
