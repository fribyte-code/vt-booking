import { AlignLeft, Building2, Check, Clock, Gavel, MapPin, User, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { useApprove } from '../../hooks/useApprove'
import { formatDate, formatDateTime, formatTimeRange, isFuture } from '../../lib/dates'
import { errorMessage } from '../../lib/errors'
import { findConflicts } from '../../services/bookingRules'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert } from '../ui/fields'
import { Modal } from '../ui/Modal'
import { RejectDialog } from './RejectDialog'
import { RoomDot, StatusBadge } from './badges'

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <span className="mt-0.5 text-slate-400 [&>svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1 text-sm text-slate-700">{children}</div>
    </div>
  )
}

export function BookingDetailsDialog({ bookingId }: { bookingId: string }) {
  const app = useApp()
  const { approve, busyId } = useApprove()
  const [mode, setMode] = useState<'view' | 'cancel' | 'reject'>('view')

  const booking = app.data.bookings.find((b) => b.id === bookingId)
  if (!booking) return null

  const room = app.room(booking.roomId)
  const org = app.organization(booking.organizationId)
  const requesterName = app.user(booking.requestedById)?.name ?? booking.requestedByName
  const deciderName = (booking.decidedById ? app.user(booking.decidedById)?.name : undefined) ?? booking.decidedByName
  const isAdmin = app.currentUser.role === 'ADMIN'
  const isOwner = booking.requestedById === app.currentUser.id
  const active = booking.status === 'APPROVED' || booking.status === 'PENDING'
  const canCancel = (isOwner || isAdmin) && active && isFuture(booking.start)
  const canDecide = isAdmin && booking.status === 'PENDING'
  const conflicts =
    booking.status === 'PENDING' ? findConflicts(app.data.bookings, booking.roomId, booking.start, booking.end, booking.id) : []

  if (mode === 'reject') {
    return <RejectDialog booking={booking} onClose={app.closeBookingDetails} />
  }

  if (mode === 'cancel') {
    return (
      <ConfirmDialog
        title={booking.status === 'PENDING' ? 'Trekk tilbake søknad?' : 'Kanseller booking?'}
        confirmLabel={booking.status === 'PENDING' ? 'Trekk tilbake' : 'Kanseller'}
        destructive
        onClose={() => setMode('view')}
        onConfirm={async () => {
          try {
            await app.cancelBooking(booking.id)
            app.notify(`«${booking.title}» er kansellert.`, 'info')
            app.closeBookingDetails()
          } catch (err) {
            app.notify(errorMessage(err), 'error')
            setMode('view')
          }
        }}
      >
        «{booking.title}» i {room?.name}, {formatDate(booking.start)} {formatTimeRange(booking.start, booking.end)}.
        Tidsrommet blir ledig for andre.
      </ConfirmDialog>
    )
  }

  return (
    <Modal
      title={booking.title}
      leading={<RoomDot color={room?.color ?? '#94a3b8'} className="mt-2" />}
      onClose={app.closeBookingDetails}
      footer={
        (canCancel || canDecide) && (
          <>
            {canCancel && (
              <Button variant="danger" onClick={() => setMode('cancel')} className="mr-auto">
                {booking.status === 'PENDING' ? 'Trekk tilbake' : 'Kanseller'}
              </Button>
            )}
            {canDecide && (
              <>
                <Button onClick={() => setMode('reject')}>
                  <X className="size-4" /> Avslå
                </Button>
                <Button
                  variant="success"
                  disabled={conflicts.length > 0 || busyId === booking.id}
                  onClick={async () => {
                    if (await approve(booking)) app.closeBookingDetails()
                  }}
                >
                  <Check className="size-4" /> Godkjenn
                </Button>
              </>
            )}
          </>
        )
      }
    >
      <div className="mb-2">
        <StatusBadge status={booking.status} />
      </div>
      <div className="divide-y divide-slate-100">
        <Row icon={<Clock />}>
          <p className="font-medium text-slate-900 first-letter:uppercase">{formatDate(booking.start)}</p>
          <p>{formatTimeRange(booking.start, booking.end)}</p>
        </Row>
        <Row icon={<MapPin />}>
          <p className="font-medium text-slate-900">{room?.name}</p>
          <p className="text-slate-500">
            {room?.location} · {room?.capacity} plasser
          </p>
        </Row>
        <Row icon={<Building2 />}>{org?.name}</Row>
        {/* The API only names the requester for the own organization and administrators. */}
        {requesterName && (
          <Row icon={<User />}>
            Booket av {requesterName}
            <span className="text-slate-500"> · {formatDateTime(booking.createdAt)}</span>
          </Row>
        )}
        {booking.description && (
          <Row icon={<AlignLeft />}>
            <p className="whitespace-pre-line">{booking.description}</p>
          </Row>
        )}
        {booking.decidedAt && (
          <Row icon={<Gavel />}>
            {booking.status === 'REJECTED' ? 'Avslått' : 'Godkjent'} av {deciderName ?? 'administrator'}
            <span className="text-slate-500"> · {formatDateTime(booking.decidedAt)}</span>
            {booking.decisionComment && <p className="mt-1 text-slate-600 italic">«{booking.decisionComment}»</p>}
          </Row>
        )}
      </div>
      {booking.status === 'PENDING' && (
        <Alert tone={conflicts.length && isAdmin ? 'error' : 'info'} className="mt-3">
          {conflicts.length > 0 && isAdmin
            ? `Kan ikke godkjennes: rommet er allerede booket (${conflicts.map((c) => `«${c.title}»`).join(', ')}).`
            : 'Søknaden venter på behandling. Tidsrommet er ikke reservert før søknaden er godkjent.'}
        </Alert>
      )}
    </Modal>
  )
}
