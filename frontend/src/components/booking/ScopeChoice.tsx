import { useId } from 'react'
import { cn } from '../../lib/cn'

export interface ScopeOption<T extends string> {
  value: T
  label: string
  hint?: string
}

/** Which occurrences of a series an action applies to, as a compact radio group. */
export function ScopeChoice<T extends string>({
  legend,
  value,
  onChange,
  options,
}: {
  legend: string
  value: T
  onChange: (value: T) => void
  options: ScopeOption<T>[]
}) {
  const name = useId()
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{legend}</legend>
      <div className="grid gap-1.5">
        {options.map((o) => {
          const selected = o.value === value
          return (
            <label
              key={o.value}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 ring-1 ring-inset transition-colors focus-within:ring-2 focus-within:ring-blue-600',
                selected ? 'bg-slate-50 ring-2 ring-slate-900' : 'ring-slate-200 hover:bg-slate-50',
              )}
            >
              <input
                type="radio"
                name={name}
                className="mt-0.5 accent-slate-900"
                checked={selected}
                onChange={() => onChange(o.value)}
              />
              <span className="min-w-0 text-sm">
                <span className="block font-medium text-slate-900">{o.label}</span>
                {o.hint && <span className="block text-xs text-slate-500">{o.hint}</span>}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
