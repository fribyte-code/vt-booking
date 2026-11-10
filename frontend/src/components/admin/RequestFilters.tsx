import { ChevronDown, Search, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '../../lib/cn'
import { type RequestFilter, hasRequestFilter, NO_REQUEST_FILTER } from '../../services/bookingRules'
import { RoomDot } from '../booking/badges'
import { Button } from '../ui/Button'
import { Input } from '../ui/fields'
import { Popover } from '../ui/Popover'

interface Option {
  id: string
  name: string
  color?: string
}

/** A search box appears once the list is longer than this. */
const SEARCH_THRESHOLD = 6

const toggle = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: Option[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const shown = options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <Popover
      align="left"
      className="w-72 max-w-[calc(100vw-2rem)]"
      trigger={({ open, toggle: toggleOpen }) => (
        <Button size="sm" onClick={toggleOpen} aria-expanded={open} aria-haspopup="listbox">
          {label}
          {selected.length > 0 && (
            <span className="rounded-full bg-slate-900 px-1.5 text-xs text-white tabular-nums">{selected.length}</span>
          )}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </Button>
      )}
    >
      {() => (
        <div>
          {options.length > SEARCH_THRESHOLD && (
            <div className="relative border-b border-slate-100 p-2">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="search"
                autoFocus
                aria-label={`Søk i ${label.toLowerCase()}`}
                placeholder="Søk …"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 pl-8"
              />
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto p-1" role="listbox" aria-label={label} aria-multiselectable>
            {shown.map((o) => {
              const checked = selected.includes(o.id)
              return (
                <li key={o.id} role="option" aria-selected={checked}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onChange(toggle(selected, o.id))}
                      className="size-4 shrink-0 rounded border-slate-300 accent-slate-900"
                    />
                    {o.color && <RoomDot color={o.color} />}
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  </label>
                </li>
              )
            })}
            {shown.length === 0 && <li className="px-2.5 py-3 text-sm text-slate-500">Ingen treff på «{query}».</li>}
          </ul>
          {selected.length > 0 && (
            <div className="border-t border-slate-100 p-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                Fjern valg
              </button>
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}

function ActiveFilter({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-blue-800 ring-1 ring-blue-600/15 ring-inset">
      <span className="truncate">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Fjern filter ${label}`}
        className="rounded-full p-0.5 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

interface RequestFiltersProps {
  filter: RequestFilter
  onChange: (filter: RequestFilter) => void
  organizations: Option[]
  rooms: Option[]
  /** Who manages the rooms ("Forvaltes av"): VT and organizations. Left out: no such filter. */
  managers?: Option[]
  /** Requests that match, and all requests in the list before filtering. */
  shown: number
  total: number
  /** What the list holds, in singular and plural. Defaults to requests. */
  noun?: { one: string; many: string }
}

/** Filter for the request lists: any chosen organization AND any chosen room AND any chosen manager. */
export function RequestFilters({
  filter,
  onChange,
  organizations,
  rooms,
  managers,
  shown,
  total,
  noun = { one: 'søknad', many: 'søknader' },
}: RequestFiltersProps) {
  const managerIds = filter.managerIds ?? []
  const active = hasRequestFilter(filter)
  const nameOf = (options: Option[], id: string) => options.find((o) => o.id === id)?.name ?? id

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* With a single organization there is nothing to choose between. */}
        {organizations.length > 1 && (
          <MultiSelect
            label="Organisasjoner"
            options={organizations}
            selected={filter.organizationIds}
            onChange={(organizationIds) => onChange({ ...filter, organizationIds })}
          />
        )}
        <MultiSelect
          label="Rom"
          options={rooms}
          selected={filter.roomIds}
          onChange={(roomIds) => onChange({ ...filter, roomIds })}
        />
        {managers && managers.length > 1 && (
          <MultiSelect
            label="Forvaltes av"
            options={managers}
            selected={managerIds}
            onChange={(ids) => onChange({ ...filter, managerIds: ids })}
          />
        )}
        {active && (
          <Button size="sm" variant="ghost" onClick={() => onChange(NO_REQUEST_FILTER)}>
            Nullstill filtre
          </Button>
        )}
        <p role="status" className="ml-auto text-sm text-slate-500 tabular-nums">
          {active ? `${shown} av ${total} ${noun.many}` : `${total} ${total === 1 ? noun.one : noun.many}`}
        </p>
      </div>
      {active && (
        <div className="flex flex-wrap gap-1.5" aria-label="Aktive filtre">
          {filter.organizationIds.map((id) => (
            <ActiveFilter
              key={`o-${id}`}
              label={nameOf(organizations, id)}
              onRemove={() => onChange({ ...filter, organizationIds: filter.organizationIds.filter((x) => x !== id) })}
            >
              {nameOf(organizations, id)}
            </ActiveFilter>
          ))}
          {filter.roomIds.map((id) => (
            <ActiveFilter
              key={`r-${id}`}
              label={nameOf(rooms, id)}
              onRemove={() => onChange({ ...filter, roomIds: filter.roomIds.filter((x) => x !== id) })}
            >
              {nameOf(rooms, id)}
            </ActiveFilter>
          ))}
          {managerIds.map((id) => (
            <ActiveFilter
              key={`m-${id}`}
              label={nameOf(managers ?? [], id)}
              onRemove={() => onChange({ ...filter, managerIds: managerIds.filter((x) => x !== id) })}
            >
              Forvaltes av {nameOf(managers ?? [], id)}
            </ActiveFilter>
          ))}
        </div>
      )}
    </div>
  )
}
