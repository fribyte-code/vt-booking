import { cn } from '../../lib/cn'

interface Option<T extends string> {
  id: T
  label: string
  count?: number
}

/** One choice out of a few, as a row of buttons with an optional count each (e.g. Åpne · Ferdig · Avslått · Alle). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Option<T>[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-600',
              on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="text-xs text-slate-500 tabular-nums">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
