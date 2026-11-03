import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../components/ui/Button'
import { errorMessage } from '../lib/errors'
import { roomInfo } from '../lib/rooms'
import { ChangePasswordPage } from '../pages/ChangePasswordPage'
import { LoginPage } from '../pages/LoginPage'
import { dataSource } from '../services'
import { BookingError } from '../services/bookingError'
import type { DateRange } from '../services/dataSource'
import type { AppData, Booking, CreateBookingInput } from '../types'
import { AppContext, type AppContextValue, type BookingDraft, type Toast, type ToastTone } from './appContext'

const PREFS_KEY = 'vt-booking:calendar-prefs'
const DAY = 24 * 60 * 60 * 1000
// How often the data is loaded again in the background while the tab is visible, so bookings and
// requests made by others show up without a page reload. There is no push channel from the API.
const REFRESH_MS = 30_000

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

// Read-only calls that only need the data source. Defined once, so effects that depend on them
// (availability check, series preview and list) don't re-run on every provider render.
const listBookings: AppContextValue['listBookings'] = (range, roomId) => dataSource.listBookings(range, roomId)
const previewSeries: AppContextValue['previewSeries'] = (input) => dataSource.series.preview(input)
const listSeries: AppContextValue['listSeries'] = (seriesId) => dataSource.series.list(seriesId)

const isUnauthenticated = (err: unknown) => err instanceof BookingError && err.code === 'UNAUTHENTICATED'
const needsPasswordChange = (err: unknown) => err instanceof BookingError && err.code === 'PASSWORD_CHANGE_REQUIRED'
const passwordChangeRequired = () => dataSource.auth.passwordChangeRequired()

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col items-center justify-center gap-3 px-4 text-center text-sm text-slate-500">{children}</div>
}

export function AppProvider({ children }: { children: ReactNode }) {
  // undefined: checking the session. null: a login is needed.
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  // Logged in with a temporary password, which must be replaced before anything else.
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [data, setData] = useState<AppData | null>(null)
  const [range, setRange] = useState<DateRange>(initialRange)
  // Bumped to load again without changing user or range (retry, stale data).
  const [reloadKey, setReloadKey] = useState(0)
  // The reloadKey of a background refresh: it shows no loading indicator and reports no errors.
  const [backgroundKey, setBackgroundKey] = useState<number | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<CalendarPrefs>(() =>
    readPref(PREFS_KEY, { hiddenRoomIds: [], showPending: true }),
  )
  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null)
  const [detailsBookingId, setDetailsBookingId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  // Callers waiting for the next completed load (after a mutation). All loads go through the one
  // effect below, so only the latest one updates the data and a slow older one can't overwrite it.
  const [loadWaiters] = useState(() => new Set<() => void>())
  const settleWaiters = useCallback(() => {
    const waiting = [...loadWaiters]
    loadWaiters.clear()
    waiting.forEach((resolve) => resolve())
  }, [loadWaiters])
  const reloadAndWait = useCallback(
    () =>
      new Promise<void>((resolve) => {
        loadWaiters.add(resolve)
        setReloadKey((k) => k + 1)
      }),
    [loadWaiters],
  )

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
    setMustChangePassword(false)
    setData(null)
    setBookingDraft(null)
    setDetailsBookingId(null)
    settleWaiters()
  }, [settleWaiters])

  const checkSession = useCallback(async () => {
    try {
      const id = await dataSource.getSessionUserId()
      setLoadError(null)
      setMustChangePassword(passwordChangeRequired())
      setUserId(id)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    dataSource.getSessionUserId().then(
      (id) => {
        if (cancelled) return
        setMustChangePassword(passwordChangeRequired())
        setUserId(id)
      },
      (err: unknown) => !cancelled && setLoadError(errorMessage(err)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  const requestKey = `${userId}|${range.start}|${range.end}|${reloadKey}`
  const pending = !!userId && loadedKey !== requestKey
  const loading = pending && backgroundKey !== reloadKey

  useEffect(() => {
    if (!userId || mustChangePassword) return
    // Only the latest load may update state, so a slow response can't overwrite a newer one.
    let cancelled = false
    const background = backgroundKey === reloadKey
    dataSource.load(range).then(
      (next) => {
        if (cancelled) return
        // Keep the old object when nothing changed, so a refresh doesn't re-render the calendar
        // (and reset an event that is being dragged).
        setData((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
        setLoadError(null)
        setLoadedKey(requestKey)
        settleWaiters()
      },
      (err: unknown) => {
        if (cancelled) return
        setLoadedKey(requestKey)
        settleWaiters()
        if (isUnauthenticated(err)) {
          endSession()
        } else if (needsPasswordChange(err)) {
          setMustChangePassword(true)
        } else if (!background) {
          // Shown full-screen before the first load, and as a toast over existing data after it.
          setLoadError(errorMessage(err))
          notify(errorMessage(err), 'error')
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [userId, mustChangePassword, range, requestKey, reloadKey, backgroundKey, endSession, notify, settleWaiters])

  // Background refresh: some time after the last load while the tab is visible, and right away
  // when the user comes back to the tab. Never while a load is running.
  useEffect(() => {
    if (!userId || mustChangePassword || pending) return
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      setBackgroundKey(reloadKey + 1)
      setReloadKey(reloadKey + 1)
    }
    const timer = setTimeout(refresh, REFRESH_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [userId, mustChangePassword, pending, reloadKey])

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

    // An expired session sends the user back to the login. When someone else changed the booking
    // (or the server hit a concurrent write), reload so the user sees the current state and can retry.
    const handleError = (err: unknown): never => {
      if (isUnauthenticated(err)) endSession()
      else if (needsPasswordChange(err)) setMustChangePassword(true)
      else if (err instanceof BookingError && (err.code === 'VERSION_CONFLICT' || err.code === 'INVALID_STATE')) {
        setReloadKey((k) => k + 1)
      }
      throw err
    }

    // Each mutation reloads the data set.
    const mutate = async <T,>(request: () => Promise<T>) => {
      const result = await request().catch(handleError)
      // Wait for fresh data so dialogs close on the updated state. The change itself succeeded,
      // so a failed refresh is reported by the load, not as an error of the change.
      await reloadAndWait()
      return result
    }

    return {
      data,
      currentUser,
      logout: async () => {
        try {
          await dataSource.auth.logout()
        } finally {
          endSession()
        }
      },
      changePassword: async (currentPassword, newPassword) => {
        try {
          await dataSource.auth.changePassword(currentPassword, newPassword)
        } catch (err) {
          if (isUnauthenticated(err)) endSession()
          throw err
        }
      },
      reload: () => setReloadKey((k) => k + 1),
      loading,
      setVisibleRange: (next) => setRange((prev) => (covers(prev, next) ? prev : next)),

      room: (id) => data.rooms.find((r) => r.id === id),
      organization: (id) => data.organizations.find((o) => o.id === id),
      user: (id) => data.users.find((u) => u.id === id),
      roomOf: (b) => roomInfo(data.rooms.find((r) => r.id === b.roomId), b),

      listBookings,
      createBooking: (input: CreateBookingInput) => mutate(() => dataSource.createBooking(input)),
      approveBooking: (id, comment) => mutate(() => dataSource.approveBooking(booking(id), comment)),
      rejectBooking: (id, reason) => mutate(() => dataSource.rejectBooking(booking(id), reason)),
      cancelBooking: (id, reason) => mutate(() => dataSource.cancelBooking(booking(id), reason)),
      // The caller passes the booking as it was when the user started editing, so its version
      // detects changes made by others in the meantime instead of overwriting them.
      updateBooking: (original, input) => mutate(() => dataSource.updateBooking(original, input)),

      previewSeries,
      createSeries: (input) => mutate(() => dataSource.series.create(input)),
      listSeries,
      updateSeries: (from, input, options) =>
        options?.dryRun
          ? dataSource.series.update(from, input, options).catch(handleError)
          : mutate(() => dataSource.series.update(from, input, options)),
      cancelSeries: (seriesId, { fromId, reason }) =>
        mutate(() => dataSource.series.cancel(seriesId, { from: fromId ? booking(fromId) : undefined, reason })),
      approveSeries: (seriesId, comment) => mutate(() => dataSource.series.approve(seriesId, comment)),
      rejectSeries: (seriesId, reason) => mutate(() => dataSource.series.reject(seriesId, reason)),

      acceptInvitation: (id) => mutate(() => dataSource.invitations.accept(id)),
      declineInvitation: (id) => mutate(() => dataSource.invitations.decline(id)),
      markDecisionsSeen: async () => {
        await dataSource.markDecisionsSeen().catch(handleError)
        // The API marks exactly the loaded decisions and cancellations of the user's own
        // bookings as read, so the loaded data is updated in place instead of loading it again.
        setData((d) =>
          d && {
            ...d,
            bookings: d.bookings.map((b) =>
              b.requestedById === userId && (b.decidedAt || b.cancelledAt) && !b.decisionSeen ? { ...b, decisionSeen: true } : b,
            ),
          },
        )
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
  }, [data, userId, loading, prefs, bookingDraft, detailsBookingId, toasts, notify, dismissToast, endSession, updatePrefs, reloadAndWait])

  if (userId && mustChangePassword) {
    const { auth } = dataSource
    return (
      <ChangePasswordPage
        onChange={async (currentPassword, newPassword) => {
          await auth.changePassword(currentPassword, newPassword)
          setMustChangePassword(false)
          setReloadKey((k) => k + 1)
        }}
        onLogout={() => {
          auth.logout().finally(endSession)
        }}
      />
    )
  }

  if (userId === null) {
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
