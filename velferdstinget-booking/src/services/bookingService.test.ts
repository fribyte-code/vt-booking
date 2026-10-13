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
})
