import { cn } from '../../lib/cn'

const tones = {
  default: 'bg-slate-100 text-slate-700',
  dark: 'bg-slate-800 text-white',
  amber: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
}

export function Chip({ label, tone = 'default' }: { label: string; tone?: keyof typeof tones }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone])}>{label}</span>
}
