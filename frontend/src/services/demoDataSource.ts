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
    load: () => service.getDataFor(userId),
    listBookings: (range, roomId) => service.listBookings(range, roomId),

    createBooking: (input) => service.createBooking(userId, input),
    approveBooking: (booking, comment) => service.approveBooking(userId, booking.id, comment),
    rejectBooking: (booking, reason) => service.rejectBooking(userId, booking.id, reason),
    cancelBooking: (booking, reason) => service.cancelBooking(userId, booking.id, reason),
    updateBooking: (booking, input) => service.updateBooking(userId, booking.id, input),
    markDecisionsSeen: () => service.markDecisionsSeen(userId),

    series: {
      preview: (input) => service.previewSeries(userId, input),
      create: (input) => service.createSeries(userId, input),
      list: (seriesId) => service.listSeries(userId, seriesId),
      update: (from, input, options) => service.updateSeries(userId, from.seriesId ?? '', from.id, input, options),
      cancel: (seriesId, { from, reason }) => service.cancelSeries(userId, seriesId, from?.id, reason),
      approve: (seriesId, comment) => service.approveSeries(userId, seriesId, comment),
      reject: (seriesId, reason) => service.rejectSeries(userId, seriesId, reason),
    },

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
