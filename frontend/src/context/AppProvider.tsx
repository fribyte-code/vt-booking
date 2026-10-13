import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../components/ui/Button'
import { errorMessage } from '../lib/errors'
import { LoginPage } from '../pages/LoginPage'
import { dataSource } from '../services'
import { BookingError } from '../services/bookingError'
import type { DateRange } from '../services/dataSource'
import type { AppData, Booking, CreateBookingInput } from '../types'
import { AppContext, type AppContextValue, type BookingDraft, type Toast, type ToastTone } from './appContext'

const PREFS_KEY = 'vt-booking:calendar-prefs'
const DAY = 24 * 60 * 60 * 1000

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

/** A few weeks around today, until the calendar reports what it shows. */
function initialRange(): DateRange {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return {
    start: new Date(today.getTime() - 7 * DAY).toISOString(),
    end: new Date(today.getTime() + 35 * DAY).toISOString(),
  }
}

const covers = (outer: DateRange, inner: DateRange) => outer.start <= inner.start && inner.end <= outer.end

const isUnauthenticated = (err: unknown) => err instanceof BookingError && err.code === 'UNAUTHENTICATED'

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col items-center justify-center gap-3 px-4 text-center text-sm text-slate-500">{children}</div>
}

export function AppProvider({ children }: { children: ReactNode }) {
  // undefined: checking the session. null: a login is needed.
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [data, setData] = useState<AppData | null>(null)
  const [range, setRange] = useState<DateRange>(initialRange)
  // Bumped to load again without changing user or range (retry, stale data).
  const [reloadKey, setReloadKey] = useState(0)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<CalendarPrefs>(() =>
    readPref(PREFS_KEY, { hiddenRoomIds: [], showPending: true }),
  )
  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null)
  const [detailsBookingId, setDetailsBookingId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

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

  const endSession = useCallback(() => {
    setUserId(null)
    setData(null)
    setBookingDraft(null)
    setDetailsBookingId(null)
  }, [])

  const checkSession = useCallback(async () => {
    try {
      const id = await dataSource.getSessionUserId()
      setLoadError(null)
      setUserId(id)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    dataSource.getSessionUserId().then(
      (id) => !cancelled && setUserId(id),
      (err: unknown) => !cancelled && setLoadError(errorMessage(err)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  const requestKey = `${userId}|${range.start}|${range.end}|${reloadKey}`
  const loading = !!userId && loadedKey !== requestKey

  useEffect(() => {
    if (!userId) return
    // Only the latest load may update state, so a slow response can't overwrite a newer one.
    let cancelled = false
    dataSource.load(range).then(
      (next) => {
        if (cancelled) return
        setData(next)
        setLoadError(null)
        setLoadedKey(requestKey)
      },
      (err: unknown) => {
        if (cancelled) return
        setLoadedKey(requestKey)
        if (isUnauthenticated(err)) {
          endSession()
        } else {
          // Shown full-screen before the first load, and as a toast over existing data after it.
          setLoadError(errorMessage(err))
          notify(errorMessage(err), 'error')
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [userId, range, requestKey, endSession, notify])

  const updatePrefs = useCallback((next: Partial<CalendarPrefs>) => {
    setPrefs((p) => {
      const merged = { ...p, ...next }
      writePref(PREFS_KEY, merged)
      return merged
    })
  }, [])

  const value = useMemo<AppContextValue | null>(() => {
    if (!data || !userId) return null
    const currentUser = data.users.find((u) => u.id === userId)
    if (!currentUser) return null

    const booking = (id: string): Booking => {
      const found = data.bookings.find((b) => b.id === id)
      if (!found) throw new BookingError('NOT_FOUND', 'Bookingen finnes ikke.')
      return found
    }

    // Each mutation reloads the data set. An expired session sends the user back to the login.
    const mutate = async <T,>(request: () => Promise<T>) => {
      let result: T
      try {
        result = await request()
      } catch (err) {
        if (isUnauthenticated(err)) endSession()
        else if (err instanceof BookingError && (err.code === 'VERSION_CONFLICT' || err.code === 'INVALID_STATE')) {
          // Someone else changed the booking; show its current state.
          setReloadKey((k) => k + 1)
        }
        throw err
      }
      // Wait for fresh data so dialogs close on the updated state. The change itself succeeded,
      // so a failed refresh falls back to a background reload instead of reporting an error.
      try {
        setData(await dataSource.load(range))
      } catch {
        setReloadKey((k) => k + 1)
      }
      return result
    }

    return {
      data,
      currentUser,
      setCurrentUserId: (id) => {
        dataSource.demo?.switchUser(id)
        setUserId(id)
        setBookingDraft(null)
        setDetailsBookingId(null)
      },
      logout: async () => {
        try {
          await dataSource.auth?.logout()
        } finally {
          endSession()
        }
      },
      loading,
      setVisibleRange: (next) => setRange((prev) => (covers(prev, next) ? prev : next)),

      room: (id) => data.rooms.find((r) => r.id === id),
      organization: (id) => data.organizations.find((o) => o.id === id),
      user: (id) => data.users.find((u) => u.id === id),

      createBooking: (input: CreateBookingInput) => mutate(() => dataSource.createBooking(input)),
      approveBooking: (id) => mutate(() => dataSource.approveBooking(booking(id))),
      rejectBooking: (id, reason) => mutate(() => dataSource.rejectBooking(booking(id), reason)),
      cancelBooking: (id) => mutate(() => dataSource.cancelBooking(booking(id))),
      markDecisionsSeen: () => mutate(() => dataSource.markDecisionsSeen()),
      resetDemoData: async () => {
        await dataSource.demo?.reset()
        setData(await dataSource.load(range))
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
  }, [data, userId, range, loading, prefs, bookingDraft, detailsBookingId, toasts, notify, dismissToast, endSession, updatePrefs])

  if (userId === null && dataSource.auth) {
    const { login } = dataSource.auth
    return (
      <LoginPage
        onLogin={async (email, password) => {
          await login(email, password)
          await checkSession()
        }}
      />
    )
  }

  if (!value) {
    if (loadError) {
      return (
        <Centered>
          <p className="text-slate-700">{loadError}</p>
          <Button onClick={() => (userId ? setReloadKey((k) => k + 1) : checkSession())}>Prøv igjen</Button>
        </Centered>
      )
    }
    return <Centered>Laster kalender …</Centered>
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
