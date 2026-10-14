import { beforeEach, describe, expect, it } from 'vitest'
import { type BookingService, BookingError, type KeyValueStore, createBookingService } from './bookingService'

// Wednesday 14 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 14, 10, 0)

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

function slot(dayOffset: number, from: string, to: string) {
  const make = (t: string) => {
    const [h, min] = t.split(':').map(Number)
    const d = new Date(NOW)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(h, min, 0, 0)
    return d.toISOString()
  }
  return { start: make(from), end: make(to) }
}

/** Local date `YYYY-MM-DD`, `dayOffset` days after NOW. */
function dateAfter(dayOffset: number): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() + dayOffset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(BookingError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('bookingService', () => {
  let store: KeyValueStore
  let service: BookingService

  beforeEach(() => {
    store = memoryStore()
    service = createBookingService(store, () => NOW)
  })

  it('seeds data without overlapping approved bookings', async () => {
    const { bookings } = await service.getData()
    const approved = bookings.filter((b) => b.status === 'APPROVED')
    for (const a of approved) {
      for (const b of approved) {
        if (a === b || a.roomId !== b.roomId) continue
        expect(Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end)).toBe(false)
      }
    }
    expect(bookings.some((b) => b.status === 'PENDING')).toBe(true)
  })

  it('runs the acceptance scenario', async () => {
    // Direct booking for Møterom A as Organisasjon A.
    const direct = await service.createBooking('user-kari', {
      roomId: 'room-a', organizationId: 'org-a', title: 'Prøvemøte', ...slot(7, '08:00', '09:00'),
    })
    expect(direct.status).toBe('APPROVED')

    // Overlapping booking in the same room is rejected.
    await expectError(
      service.createBooking('user-ola', {
        roomId: 'room-a', organizationId: 'org-b', title: 'Kolliderer', ...slot(7, '08:30', '09:30'),
      }),
      'CONFLICT',
    )

    // Storsalen requires approval.
    const request = await service.createBooking('user-kari', {
      roomId: 'room-c', organizationId: 'org-a', title: 'Seminar', ...slot(7, '12:00', '14:00'),
    })
    expect(request.status).toBe('PENDING')

    // Only admins can approve.
    await expectError(service.approveBooking('user-kari', request.id), 'FORBIDDEN')
    const approved = await service.approveBooking('user-admin', request.id)
    expect(approved.status).toBe('APPROVED')

    // Persisted in storage and visible to a fresh service instance.
    const reloaded = await createBookingService(store, () => NOW).getData()
    expect(reloaded.bookings.find((b) => b.id === request.id)?.status).toBe('APPROVED')

    // Reset restores the seed.
    const reset = await service.resetDemoData()
    expect(reset.bookings.some((b) => b.id === request.id)).toBe(false)
  })

  it('enforces permissions and membership', async () => {
    await expectError(
      service.createBooking('user-ola', {
        roomId: 'room-b', organizationId: 'org-b', title: 'Møte', ...slot(7, '08:00', '09:00'),
      }),
      'NO_PERMISSION',
    )
    await expectError(
      service.createBooking('user-ola', {
        roomId: 'room-a', organizationId: 'org-a', title: 'Møte', ...slot(7, '08:00', '09:00'),
      }),
      'NOT_MEMBER',
    )
  })

  it('validates times', async () => {
    const base = { roomId: 'room-a', organizationId: 'org-a', title: 'Møte' }
    await expectError(service.createBooking('user-kari', { ...base, ...slot(7, '10:00', '09:00') }), 'VALIDATION')
    await expectError(service.createBooking('user-kari', { ...base, ...slot(-1, '10:00', '11:00') }), 'VALIDATION')
  })

  it('lets pending requests overlap but approves only one', async () => {
    const input = { roomId: 'room-c', title: 'Arrangement', ...slot(14, '18:00', '20:00') }
    const first = await service.createBooking('user-kari', { ...input, organizationId: 'org-a' })
    const second = await service.createBooking('user-ola', { ...input, organizationId: 'org-b' })

    await service.approveBooking('user-admin', first.id)
    await expectError(service.approveBooking('user-admin', second.id), 'CONFLICT')

    const rejected = await service.rejectBooking('user-admin', second.id, 'Opptatt')
    expect(rejected.status).toBe('REJECTED')
    expect(rejected.decisionComment).toBe('Opptatt')
  })

  it('frees the slot when a booking is cancelled', async () => {
    const input = { roomId: 'room-a', organizationId: 'org-a', title: 'Møte', ...slot(7, '08:00', '09:00') }
    const booking = await service.createBooking('user-kari', input)

    await expectError(service.cancelBooking('user-ola', booking.id), 'FORBIDDEN')
    await service.cancelBooking('user-kari', booking.id)

    const again = await service.createBooking('user-kari', input)
    expect(again.status).toBe('APPROVED')
  })

  it('enforces the duration and advance limits like the backend', async () => {
    const base = { roomId: 'room-a', organizationId: 'org-a', title: 'Møte' }
    await expectError(service.createBooking('user-kari', { ...base, ...slot(7, '08:00', '20:01') }), 'RULE_VIOLATION')
    await expectError(service.createBooking('user-kari', { ...base, ...slot(181, '08:00', '09:00') }), 'RULE_VIOLATION')
    expect((await service.createBooking('user-kari', { ...base, ...slot(40, '08:00', '20:00') })).status).toBe('APPROVED')
  })

  it('records approval comments and cancellation reasons, and notifies of cancellations by others', async () => {
    const request = await service.createBooking('user-kari', {
      roomId: 'room-c', organizationId: 'org-a', title: 'Seminar', ...slot(7, '12:00', '14:00'),
    })
    const approved = await service.approveBooking('user-admin', request.id, ' Husk å rydde ')
    expect(approved.decisionComment).toBe('Husk å rydde')

    await service.markDecisionsSeen('user-kari')
    const cancelled = await service.cancelBooking('user-admin', request.id, 'Brannøvelse')
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Brannøvelse', decisionSeen: false })

    const own = await service.createBooking('user-kari', {
      roomId: 'room-a', organizationId: 'org-a', title: 'Eget', ...slot(8, '08:00', '09:00'),
    })
    expect((await service.cancelBooking('user-kari', own.id)).decisionSeen).toBeUndefined()
  })

  it('lists one room\'s approved bookings and unexpired requests for availability checks', async () => {
    const day = slot(9, '00:00', '23:59')
    const range = { start: day.start, end: new Date(Date.parse(day.start) + 86_400_000).toISOString() }
    const request = await service.createBooking('user-kari', {
      roomId: 'room-c', organizationId: 'org-a', title: 'Søknad', ...slot(9, '08:00', '09:00'),
    })
    await service.createBooking('user-kari', {
      roomId: 'room-a', organizationId: 'org-a', title: 'Annet rom', ...slot(9, '08:00', '09:00'),
    })
    expect((await service.listBookings(range, 'room-c')).map((b) => b.id)).toContain(request.id)
    expect((await service.listBookings(range, 'room-c')).some((b) => b.roomId !== 'room-c')).toBe(false)

    // Nine days later the request has expired and is no longer listed.
    const later = createBookingService(store, () => new Date(Date.parse(slot(9, '08:30', '09:00').start)))
    expect((await later.listBookings(range, 'room-c')).map((b) => b.id)).not.toContain(request.id)
  })

  describe('editing', () => {
    it('keeps the status for a new title and follows the room permission when moving', async () => {
      const booking = await service.createBooking('user-kari', {
        roomId: 'room-a', organizationId: 'org-a', title: 'Møte', ...slot(7, '06:00', '07:00'),
      })
      const renamed = await service.updateBooking('user-kari', booking.id, {
        roomId: 'room-a', title: 'Styremøte', ...slot(7, '06:00', '07:00'),
      })
      expect(renamed).toMatchObject({ title: 'Styremøte', status: 'APPROVED', updatedById: 'user-kari' })
      expect(renamed.updatedAt).toBe(NOW.toISOString())

      // Storsalen needs approval for Organisasjon A: the booking becomes a new request.
      const moved = await service.updateBooking('user-kari', booking.id, {
        roomId: 'room-c', title: 'Styremøte', ...slot(7, '06:00', '07:00'),
      })
      expect(moved).toMatchObject({ roomId: 'room-c', status: 'PENDING', requiresApproval: true })

      await service.approveBooking('user-admin', booking.id)
      // A system administrator moving an approved booking keeps it approved.
      const byAdmin = await service.updateBooking('user-admin', booking.id, {
        roomId: 'room-c', title: 'Styremøte', ...slot(7, '06:30', '07:30'),
      })
      expect(byAdmin.status).toBe('APPROVED')
      expect(byAdmin.decidedAt).toBeDefined()

      // The requester moving it again loses the approval until it is approved again.
      const byRequester = await service.updateBooking('user-kari', booking.id, {
        roomId: 'room-c', title: 'Styremøte', ...slot(7, '06:00', '07:00'),
      })
      expect(byRequester).toMatchObject({ status: 'PENDING' })
      expect(byRequester.decidedAt).toBeUndefined()
    })

    it('refuses other organizations, taken times and finished bookings', async () => {
      const booking = await service.createBooking('user-kari', {
        roomId: 'room-a', organizationId: 'org-a', title: 'Møte', ...slot(7, '06:00', '07:00'),
      })
      await service.createBooking('user-ola', {
        roomId: 'room-a', organizationId: 'org-b', title: 'Annet', ...slot(7, '07:00', '08:00'),
      })
      const input = { roomId: 'room-a', title: 'Møte', ...slot(7, '06:30', '07:30') }
      await expectError(service.updateBooking('user-ola', booking.id, input), 'FORBIDDEN')
      await expectError(service.updateBooking('user-kari', booking.id, input), 'CONFLICT')
      await service.cancelBooking('user-kari', booking.id)
      await expectError(service.updateBooking('user-kari', booking.id, { ...input, ...slot(7, '05:00', '06:00') }), 'INVALID_STATE')
    })
  })

  describe('weekly series', () => {
    const series = (patch: object = {}) => ({
      roomId: 'room-a',
      organizationId: 'org-a',
      title: 'Øving',
      ...slot(7, '06:00', '07:00'),
      recurrence: { intervalWeeks: 1, until: dateAfter(28) },
      ...patch,
    })

    it('previews and creates a series, skipping taken dates only when asked', async () => {
      await service.createBooking('user-ola', {
        roomId: 'room-a', organizationId: 'org-b', title: 'Opptatt', ...slot(14, '06:30', '07:30'),
      })
      const preview = await service.previewSeries('user-kari', series())
      expect(preview.map((o) => o.conflict)).toEqual([false, true, false, false])

      await expect(service.createSeries('user-kari', series())).rejects.toMatchObject({
        code: 'CONFLICT',
        conflicts: [expect.objectContaining(slot(14, '06:00', '07:00'))],
      })
      const created = await service.createSeries('user-kari', series({ skipConflicts: true }))
      expect(created.created).toHaveLength(3)
      expect(created.skipped).toEqual([slot(14, '06:00', '07:00')])
      expect(new Set(created.created.map((b) => b.seriesId))).toEqual(new Set([created.seriesId]))
      expect((await service.listSeries('user-kari', created.seriesId)).map((b) => b.status)).toEqual([
        'APPROVED', 'APPROVED', 'APPROVED',
      ])
      await expectError(service.createSeries('user-kari', series({ recurrence: { intervalWeeks: 1, until: dateAfter(7) } })), 'VALIDATION')
    })

    it('edits an occurrence and the following ones, with a dry run and skipped conflicts', async () => {
      const { seriesId, created } = await service.createSeries('user-kari', series())
      await service.createBooking('user-ola', {
        roomId: 'room-a', organizationId: 'org-b', title: 'Opptatt', ...slot(28, '08:00', '09:00'),
      })
      const from = created[1]
      const input = { roomId: 'room-a', title: 'Øving', ...slot(14, '08:00', '09:30') }

      await expect(service.updateSeries('user-kari', seriesId, from.id, input)).rejects.toMatchObject({
        code: 'CONFLICT',
        conflicts: [expect.objectContaining({ id: created[3].id })],
      })
      const dry = await service.updateSeries('user-kari', seriesId, from.id, input, { dryRun: true, skipConflicts: true })
      expect(dry.updated.map((b) => b.start)).toEqual([slot(14, '08:00', '09:30').start, slot(21, '08:00', '09:30').start])
      expect(dry.skipped.map((s) => s.id)).toEqual([created[3].id])
      // Nothing was saved.
      expect((await service.listSeries('user-kari', seriesId))[1].start).toBe(from.start)

      await service.updateSeries('user-kari', seriesId, from.id, input, { skipConflicts: true })
      const after = await service.listSeries('user-kari', seriesId)
      expect(after.map((b) => b.end)).toEqual([
        slot(7, '06:00', '07:00').end,
        slot(14, '08:00', '09:30').end,
        slot(21, '08:00', '09:30').end,
        slot(28, '06:00', '07:00').end,
      ])
    })

    it('cancels from an occurrence on, or every future occurrence', async () => {
      const { seriesId, created } = await service.createSeries('user-kari', series())
      expect(await service.cancelSeries('user-kari', seriesId, created[2].id)).toHaveLength(2)
      await expectError(service.cancelSeries('user-ola', seriesId), 'FORBIDDEN')
      const rest = await service.cancelSeries('user-admin', seriesId, undefined, 'Ferie')
      expect(rest.map((b) => b.id)).toEqual([created[0].id, created[1].id])
      expect(rest[0]).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Ferie', decisionSeen: false })
      await expectError(service.cancelSeries('user-kari', seriesId), 'INVALID_STATE')
    })

    it('lets administrators decide a whole series and reports what could not be approved', async () => {
      const { seriesId, created } = await service.createSeries('user-kari', series({ roomId: 'room-c' }))
      expect(created.every((b) => b.status === 'PENDING')).toBe(true)
      const other = await service.createBooking('user-ola', {
        roomId: 'room-c', organizationId: 'org-b', title: 'Konsert', ...slot(14, '06:00', '08:00'),
      })
      await service.approveBooking('user-admin', other.id)

      await expectError(service.approveSeries('user-kari', seriesId), 'FORBIDDEN')
      const result = await service.approveSeries('user-admin', seriesId, 'Ok')
      expect(result.approved).toHaveLength(3)
      expect(result.notApproved).toEqual([expect.objectContaining({ id: created[1].id, code: 'CONFLICT' })])

      await expectError(service.rejectSeries('user-admin', seriesId, ' '), 'VALIDATION')
      expect(await service.rejectSeries('user-admin', seriesId, 'Opptatt')).toHaveLength(1)
    })
  })
})
