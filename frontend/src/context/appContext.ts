import { createContext } from 'react'
import type { DateRange } from '../services/dataSource'
import type { AppData, Booking, CreateBookingInput, Organization, Room, User } from '../types'

export interface BookingDraft {
  start?: string
  end?: string
  roomId?: string
}

export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

export interface AppContextValue {
  data: AppData
  currentUser: User
  /** Demo mode only: switch the simulated user. */
  setCurrentUserId: (id: string) => void
  /** API mode only: end the session. */
  logout: () => Promise<void>
  /** API mode only: change the signed-in user's password. */
  changePassword?: (currentPassword: string, newPassword: string) => Promise<void>
  /** Load the data again, e.g. after an administrator changed rooms or organizations. */
  reload: () => void
  /** True while data is being (re)loaded, e.g. after navigating the calendar. */
  loading: boolean
  /** The calendar's visible period, so API mode can load bookings for it. */
  setVisibleRange: (range: DateRange) => void

  room: (id: string) => Room | undefined
  organization: (id: string) => Organization | undefined
  user: (id: string) => User | undefined

  createBooking: (input: CreateBookingInput) => Promise<Booking>
  approveBooking: (id: string) => Promise<Booking>
  rejectBooking: (id: string, reason: string) => Promise<Booking>
  cancelBooking: (id: string) => Promise<Booking>
  markDecisionsSeen: () => Promise<void>
  resetDemoData: () => Promise<void>

  visibleRoomIds: string[]
  toggleRoom: (id: string) => void
  showPending: boolean
  setShowPending: (value: boolean) => void

  bookingDraft: BookingDraft | null
  openBookingDialog: (draft?: BookingDraft) => void
  closeBookingDialog: () => void
  detailsBookingId: string | null
  openBookingDetails: (id: string) => void
  closeBookingDetails: () => void

  toasts: Toast[]
  notify: (message: string, tone?: ToastTone) => void
  dismissToast: (id: number) => void
}

export const AppContext = createContext<AppContextValue | null>(null)
