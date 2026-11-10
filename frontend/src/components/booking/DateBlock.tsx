/** The day as in the booking lists: weekday, date and month, stacked. */
export function DateBlock({ date }: { date: string }) {
  const d = new Date(date)
  return (
    <div className="w-12 shrink-0 text-center" aria-hidden>
      <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {d.toLocaleDateString('nb-NO', { weekday: 'short' }).replace('.', '')}
      </div>
      <div className="text-2xl leading-8 font-medium text-slate-900">{d.getDate()}</div>
      <div className="text-xs text-slate-500">{d.toLocaleDateString('nb-NO', { month: 'short' }).replace('.', '')}</div>
    </div>
  )
}
