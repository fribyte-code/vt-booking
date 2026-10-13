import { createContext } from 'react'
import type { Booking, CreateBookingInput, DemoData, Organization, Room, User } from '../types'

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
  data: DemoData
  currentUser: User
  setCurrentUserId: (id: string) => void

  room: (id: string) => Room | undefined
  organization: (id: string) => Organization | undefined
  user: (id: string) => User | undefined

  createBooking: (input: CreateBookingInput) => Promise<Booking>
  approveBooking: (id: string) => Promise<Booking>
  rejectBooking: (id: string, comment?: string) => Promise<Booking>
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
