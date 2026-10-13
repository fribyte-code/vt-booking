import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { bookingService } from '../services/bookingService'
import type { CreateBookingInput, DemoData } from '../types'
import { AppContext, type AppContextValue, type BookingDraft, type Toast, type ToastTone } from './appContext'

const USER_KEY = 'vt-booking:current-user'
const PREFS_KEY = 'vt-booking:calendar-prefs'

let nextToastId = 0

function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Preferences are a convenience only.
  }
}

interface CalendarPrefs {
  hiddenRoomIds: string[]
  showPending: boolean
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DemoData | null>(null)
  const [currentUserId, setCurrentUserIdState] = useState(() => readPref(USER_KEY, 'user-kari'))
  const [prefs, setPrefs] = useState<CalendarPrefs>(() =>
    readPref(PREFS_KEY, { hiddenRoomIds: [], showPending: true }),
  )
  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null)
  const [detailsBookingId, setDetailsBookingId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    bookingService.getData().then(setData)
  }, [])

  const reload = useCallback(async () => {
    setData(await bookingService.getData())
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = ++nextToastId
      setToasts((ts) => [...ts.slice(-2), { id, message, tone }])
      setTimeout(() => dismissToast(id), 4500)
    },
    [dismissToast],
  )

  const updatePrefs = useCallback((next: Partial<CalendarPrefs>) => {
    setPrefs((p) => {
      const merged = { ...p, ...next }
      writePref(PREFS_KEY, merged)
      return merged
    })
  }, [])

  const value = useMemo<AppContextValue | null>(() => {
    if (!data) return null
    const currentUser = data.users.find((u) => u.id === currentUserId) ?? data.users[0]

    // Each mutation reloads the full data set, the same way a real client would refetch.
    const mutate = async <T,>(request: Promise<T>) => {
      const result = await request
      await reload()
      return result
    }

    return {
      data,
      currentUser,
      setCurrentUserId: (id) => {
        writePref(USER_KEY, id)
        setCurrentUserIdState(id)
        setBookingDraft(null)
        setDetailsBookingId(null)
      },

      room: (id) => data.rooms.find((r) => r.id === id),
      organization: (id) => data.organizations.find((o) => o.id === id),
      user: (id) => data.users.find((u) => u.id === id),

      createBooking: (input: CreateBookingInput) => mutate(bookingService.createBooking(currentUser.id, input)),
      approveBooking: (id) => mutate(bookingService.approveBooking(currentUser.id, id)),
      rejectBooking: (id, comment) => mutate(bookingService.rejectBooking(currentUser.id, id, comment)),
      cancelBooking: (id) => mutate(bookingService.cancelBooking(currentUser.id, id)),
      markDecisionsSeen: () => mutate(bookingService.markDecisionsSeen(currentUser.id)),
      resetDemoData: async () => {
        setData(await bookingService.resetDemoData())
        setBookingDraft(null)
        setDetailsBookingId(null)
      },

      visibleRoomIds: data.rooms.map((r) => r.id).filter((id) => !prefs.hiddenRoomIds.includes(id)),
      toggleRoom: (id) =>
        updatePrefs({
          hiddenRoomIds: prefs.hiddenRoomIds.includes(id)
            ? prefs.hiddenRoomIds.filter((r) => r !== id)
            : [...prefs.hiddenRoomIds, id],
        }),
      showPending: prefs.showPending,
      setShowPending: (showPending) => updatePrefs({ showPending }),

      bookingDraft,
      openBookingDialog: (draft = {}) => {
        setDetailsBookingId(null)
        setBookingDraft(draft)
      },
      closeBookingDialog: () => setBookingDraft(null),
      detailsBookingId,
      openBookingDetails: setDetailsBookingId,
      closeBookingDetails: () => setDetailsBookingId(null),

      toasts,
      notify,
      dismissToast,
    }
  }, [data, currentUserId, prefs, bookingDraft, detailsBookingId, toasts, notify, dismissToast, reload, updatePrefs])

  if (!value) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-slate-500">Laster kalender …</div>
    )
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
