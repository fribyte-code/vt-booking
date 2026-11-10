import { cn } from '../../lib/cn'

interface Tab<T extends string> {
  id: T
  label: string
  count?: number
  /** A short line under the label, e.g. who the tab's items come from. */
  hint?: string
}

/**
 * A row of tabs. When any tab has a hint, every tab gets the hint line (empty where there is none),
 * so the names line up, the hints line up under them, and all tabs are the same height.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Tab<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  const hints = tabs.some((t) => t.hint)
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
              '-mb-px flex shrink-0 flex-col items-start border-b-2 px-3 py-2.5 text-left text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-blue-600',
              active ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <span className="flex h-5 items-center gap-2">
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
            {hints && (
              <span className="h-4 text-[11px] leading-4 font-normal text-slate-400" aria-hidden={!tab.hint}>
                {tab.hint}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
