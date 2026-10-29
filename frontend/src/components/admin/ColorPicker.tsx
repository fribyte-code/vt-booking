import { Check, Pipette } from 'lucide-react'
import { cn } from '../../lib/cn'
import { ROOM_PALETTE, sameColor } from '../../lib/color'

/**
 * Palette swatches plus a custom color. Colors other items already use are marked with a dot
 * and named in the tooltip, but stay selectable.
 */
export function ColorPicker({
  id,
  value,
  onChange,
  usedBy,
}: {
  id: string
  value: string
  onChange: (color: string) => void
  /** Color → names of the other items using it. */
  usedBy: (color: string) => string[]
}) {
  const custom = !ROOM_PALETTE.some((c) => sameColor(c, value))
  const takenBy = usedBy(value)

  const swatch = (color: string, selected: boolean) => {
    const users = usedBy(color)
    return (
      <span
        className={cn(
          'relative flex size-8 items-center justify-center rounded-lg text-white ring-offset-2 transition-shadow',
          selected ? 'ring-2 ring-slate-900' : 'group-hover:ring-2 group-hover:ring-slate-300',
        )}
        style={{ backgroundColor: color }}
      >
        {selected && <Check className="size-4" />}
        {users.length > 0 && (
          <span aria-hidden className="absolute -top-1 -right-1 size-3 rounded-full bg-white" style={{ boxShadow: `inset 0 0 0 2px ${color}` }} />
        )}
      </span>
    )
  }

  const label = (color: string) => {
    const users = usedBy(color)
    return users.length > 0 ? `${color} – i bruk av ${users.join(', ')}` : `${color} – ledig`
  }

  return (
    <div className="space-y-1.5">
      <p id={`${id}-label`} className="text-sm font-medium text-slate-700">
        Farge
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
        {ROOM_PALETTE.map((color) => {
          const selected = sameColor(color, value)
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label(color)}
              title={label(color)}
              className="group rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              onClick={() => onChange(color)}
            >
              {swatch(color, selected)}
            </button>
          )
        })}
        <label
          title="Egen farge"
          className="group relative cursor-pointer rounded-lg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600"
        >
          {custom ? (
            swatch(value, true)
          ) : (
            <span className="flex size-8 items-center justify-center rounded-lg text-slate-500 ring-1 ring-slate-300 ring-inset group-hover:bg-slate-50">
              <Pipette className="size-4" />
            </span>
          )}
          <input
            type="color"
            aria-label="Egen farge"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        {takenBy.length > 0
          ? `Fargen brukes også av ${takenBy.join(', ')}. Du kan likevel velge den.`
          : 'Farger med prikk er allerede i bruk, men kan fortsatt velges.'}
      </p>
    </div>
  )
}
