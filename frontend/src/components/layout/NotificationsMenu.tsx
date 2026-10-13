import { Bell, CheckCircle2, XCircle } from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { formatDate, formatTimeRange } from '../../lib/dates'
import { IconButton } from '../ui/Button'
import { Popover } from '../ui/Popover'

/** Simulates the requester being notified of the admin's decision. */
export function NotificationsMenu() {
  const app = useApp()
  const unseen = app.data.bookings
    .filter(
      (b) =>
        b.requestedById === app.currentUser.id &&
        b.decidedAt &&
        !b.decisionSeen &&
        (b.status === 'APPROVED' || b.status === 'REJECTED'),
    )
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))

  return (
    <Popover
      className="w-[min(22rem,calc(100vw-2rem))]"
      trigger={({ open, toggle }) => (
        <span className="relative inline-flex">
          <IconButton aria-label={`Varsler (${unseen.length} nye)`} aria-expanded={open} onClick={toggle}>
            <Bell className="size-5" />
          </IconButton>
          {unseen.length > 0 && (
            <span className="pointer-events-none absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-semibold text-white">
              {unseen.length}
            </span>
          )}
        </span>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Varsler</p>
            {unseen.length > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-blue-700 hover:underline"
                onClick={() => {
                  app.markDecisionsSeen()
                  close()
                }}
              >
                Merk alle som lest
              </button>
            )}
          </div>
          {unseen.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Ingen nye varsler.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {unseen.map((b) => {
                const approved = b.status === 'APPROVED'
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50"
                      onClick={() => {
                        app.openBookingDetails(b.id)
                        close()
                      }}
                    >
                      {approved ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                      )}
                      <span className="text-sm text-slate-700">
                        Søknaden <span className="font-medium text-slate-900">«{b.title}»</span> i{' '}
                        {app.room(b.roomId)?.name} ble {approved ? 'godkjent' : 'avslått'}.
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {formatDate(b.start)}, {formatTimeRange(b.start, b.end)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Popover>
  )
}
