import { createBookingService, type KeyValueStore } from './bookingService'
import type { DataSource } from './dataSource'

const USER_KEY = 'vt-booking:current-user'
const DEFAULT_USER_ID = 'user-kari'

function browserStore(): KeyValueStore {
  try {
    const probe = '__vt_probe__'
    window.localStorage.setItem(probe, probe)
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    // Private mode or blocked storage: keep data in memory for this session.
    const memory = new Map<string, string>()
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    }
  }
}

/**
 * Standalone demo: mock data in localStorage and a simulated "logged-in" user.
 * It makes no network requests, so demo users and data can never reach an API.
 */
export function createDemoDataSource(store: KeyValueStore = browserStore()): DataSource {
  const service = createBookingService(store)
  let userId = DEFAULT_USER_ID
  try {
    userId = JSON.parse(store.getItem(USER_KEY) ?? 'null') ?? DEFAULT_USER_ID
  } catch {
    // Corrupt preference: keep the default user.
  }

  return {
    async getSessionUserId() {
      const { users } = await service.getData()
      return users.some((u) => u.id === userId) ? userId : (users[0]?.id ?? null)
    },
    load: () => service.getData(),

    createBooking: (input) => service.createBooking(userId, input),
    approveBooking: (booking) => service.approveBooking(userId, booking.id),
    rejectBooking: (booking, reason) => service.rejectBooking(userId, booking.id, reason),
    cancelBooking: (booking) => service.cancelBooking(userId, booking.id),
    markDecisionsSeen: () => service.markDecisionsSeen(userId),

    demo: {
      switchUser(id) {
        userId = id
        store.setItem(USER_KEY, JSON.stringify(id))
      },
      async reset() {
        await service.resetDemoData()
      },
    },
  }
}
