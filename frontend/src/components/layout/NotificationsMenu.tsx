import { Ban, Bell, CheckCircle2, MailPlus, XCircle } from 'lucide-react'
import type { Booking } from '../../types'
import { useApp } from '../../hooks/useApp'
import { formatDate, formatTimeRange } from '../../lib/dates'
import { IconButton } from '../ui/Button'
import { Popover } from '../ui/Popover'
import { InvitationActions, InvitationText } from './InvitationBanner'

/** A cancellation by an administrator, not by the requester themselves. */
const cancelledByOther = (b: Booking) =>
  b.status === 'CANCELLED' && !!b.cancelledById && b.cancelledById !== b.requestedById

/** When the news happened: the decision, or a cancellation by someone else. */
const newsAt = (b: Booking) => (cancelledByOther(b) ? b.cancelledAt : b.decidedAt) ?? ''

/**
 * Tells the requester what happened to their bookings: an admin's decision on a request, or a
 * cancellation by an organization or system administrator. Read state is kept per browser in API mode.
 */
export function NotificationsMenu() {
  const app = useApp()
  const unseen = app.data.bookings
    .filter(
      (b) =>
        b.requestedById === app.currentUser.id &&
        !b.decisionSeen &&
        (cancelledByOther(b) || (b.decidedAt && (b.status === 'APPROVED' || b.status === 'REJECTED'))),
    )
    .sort((a, b) => newsAt(b).localeCompare(newsAt(a)))
  // API mode: invitations to organizations, answered right here.
  const invitations = app.acceptInvitation ? (app.data.invitations ?? []) : []
  const count = unseen.length + invitations.length

  return (
    <Popover
      className="w-[min(22rem,calc(100vw-2rem))]"
      trigger={({ open, toggle }) => (
        <span className="relative inline-flex">
          <IconButton aria-label={`Varsler (${count} nye)`} aria-expanded={open} onClick={toggle}>
            <Bell className="size-5" />
          </IconButton>
          {count > 0 && (
            <span className="pointer-events-none absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-semibold text-white">
              {count}
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
          {invitations.length > 0 && (
            <ul className="divide-y divide-slate-100 border-b border-slate-100 bg-blue-50/50">
              {invitations.map((inv) => (
                <li key={inv.id} className="space-y-2 px-4 py-3">
                  <p className="flex gap-3 text-sm text-slate-700">
                    <MailPlus className="mt-0.5 size-4 shrink-0 text-blue-700" />
                    <span>
                      <InvitationText invitation={inv} />
                    </span>
                  </p>
                  <div className="flex justify-end">
                    <InvitationActions invitation={inv} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {unseen.length === 0 ? (
            invitations.length === 0 && 
            <p className="px-4 py-6 text-center text-sm text-slate-500">Ingen nye varsler.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {unseen.map((b) => {
                const approved = b.status === 'APPROVED'
                const cancelled = b.status === 'CANCELLED'
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
                      {cancelled ? (
                        <Ban className="mt-0.5 size-4 shrink-0 text-slate-500" />
                      ) : approved ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                      )}
                      <span className="text-sm text-slate-700">
                        {cancelled ? 'Bookingen' : 'Søknaden'}{' '}
                        <span className="font-medium text-slate-900">«{b.title}»</span> i {app.roomOf(b).name} ble{' '}
                        {cancelled ? `kansellert av ${b.cancelledByName ?? 'en administrator'}` : approved ? 'godkjent' : 'avslått'}.
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
