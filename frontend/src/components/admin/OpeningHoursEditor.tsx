import { Copy } from 'lucide-react'
import { useId } from 'react'
import { cn } from '../../lib/cn'
import { OPENING_TIME, WEEKDAYS, weekdayNames as dayNames } from '../../services/bookingRules'
import type { OpeningHoursEntry, Weekday } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/fields'

/**
 * A room's opening hours, one interval per weekday. Off: open around the clock (apart from
 * 05:00–07:00, which applies everywhere). On: only the checked days, within their hours; a booking
 * can't go past the closing time, so a day open until midnight closes at 24:00.
 */
export function OpeningHoursEditor({ value, onChange }: { value: OpeningHoursEntry[]; onChange: (hours: OpeningHoursEntry[]) => void }) {
  const id = useId()
  const limited = value.length > 0
  const entry = (day: Weekday) => value.find((h) => h.day === day)
  const sorted = (hours: OpeningHoursEntry[]) => [...hours].sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day))
  const set = (day: Weekday, patch: Partial<OpeningHoursEntry> | null) => {
    const others = value.filter((h) => h.day !== day)
    if (patch === null) onChange(others)
    else onChange(sorted([...others, { day, opens: '08:00', closes: '16:00', ...entry(day), ...patch }]))
  }
  const copyMondayToWeekdays = () => {
    const monday = entry('MONDAY')
    if (!monday) return
    const weekdays: Weekday[] = ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
    onChange(sorted([...value.filter((h) => !weekdays.includes(h.day)), ...weekdays.map((day) => ({ ...monday, day }))]))
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">Åpningstider</legend>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={limited}
          onChange={(e) =>
            onChange(e.target.checked ? WEEKDAYS.map((day) => ({ day, opens: '08:00', closes: '16:00' })) : [])
          }
        />
        Rommet kan bare bookes innenfor faste åpningstider
      </label>
      <p className="text-xs text-slate-500">
        {limited
          ? 'En booking må ligge innenfor åpningstiden den dagen den starter. Skriv 24:00 for midnatt. Uansett er alle rom stengt 05:00–07:00.'
          : 'Uten åpningstider kan rommet bookes hele døgnet, unntatt 05:00–07:00.'}
      </p>
      {limited && (
        <div className="space-y-1.5">
          {WEEKDAYS.map((day) => {
            const h = entry(day)
            return (
              <div key={day} className="flex flex-wrap items-center gap-2">
                <label className="flex w-28 items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={!!h} onChange={(e) => set(day, e.target.checked ? {} : null)} />
                  {dayNames[day]}
                </label>
                {h ? (
                  <>
                    <Input
                      aria-label={`${dayNames[day]} åpner`}
                      id={`${id}-${day}-opens`}
                      className={cn('h-8! w-20!', !OPENING_TIME.test(h.opens) && 'ring-red-400!')}
                      inputMode="numeric"
                      placeholder="08:00"
                      maxLength={5}
                      value={h.opens}
                      onChange={(e) => set(day, { opens: e.target.value })}
                    />
                    <span className="text-sm text-slate-500">–</span>
                    <Input
                      aria-label={`${dayNames[day]} stenger`}
                      className={cn('h-8! w-20!', !OPENING_TIME.test(h.closes) && 'ring-red-400!')}
                      inputMode="numeric"
                      placeholder="24:00"
                      maxLength={5}
                      value={h.closes}
                      onChange={(e) => set(day, { closes: e.target.value })}
                    />
                    {day === 'MONDAY' && (
                      <Button size="sm" variant="ghost" onClick={copyMondayToWeekdays}>
                        <Copy className="size-4" /> Kopier til tir–fre
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-slate-500">Stengt</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}
