import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { cn } from '../../lib/cn'

const icons = { success: CheckCircle2, error: AlertCircle, info: Info }
const iconColors = { success: 'text-emerald-400', error: 'text-red-400', info: 'text-sky-300' }

export function Toaster() {
  const { toasts, dismissToast } = useApp()

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:right-6 sm:left-auto sm:items-end"
    >
      {toasts.map((t) => {
        const Icon = icons[t.tone]
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', iconColors[t.tone])} />
            <p className="flex-1">{t.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Lukk varsel"
              className="-mr-1 rounded text-slate-400 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
