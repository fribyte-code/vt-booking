import { cn } from '../../lib/cn'

interface Tab<T extends string> {
  id: T
  label: string
  count?: number
  /** A short line under the label, e.g. who the tab's items come from. */
  hint?: string
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Tab<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px flex shrink-0 flex-col items-start justify-center border-b-2 px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-blue-600',
              active ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <span className="flex items-center gap-2">
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs tabular-nums',
                    active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </span>
            {tab.hint && <span className="text-[11px] leading-tight font-normal text-slate-400">{tab.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
