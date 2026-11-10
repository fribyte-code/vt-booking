import { createContext } from 'react'
import type { DateRange } from '../services/dataSource'
import type { RoomInfo } from '../lib/rooms'
import type {
  AppData,
  Booking,
  CreateBookingInput,
  CreateSeriesInput,
  Organization,
  Room,
  SeriesApproved,
  SeriesCreated,
  SeriesPreviewOccurrence,
  SeriesUpdated,
  SeriesUpdateOptions,
  UpdateBookingInput,
  User,
} from '../types'

export interface BookingDraft {
  start?: string
  end?: string
  roomId?: string
  /** Edit this booking instead of creating a new one. */
  bookingId?: string
  title?: string
  description?: string
  /**
   * Book for a request from the public form: an admin picks any organization, and the request is
   * marked as transferred in the same server call. `onCreated` runs after the booking is made.
   */
  publicRequestId?: string
  onCreated?: () => void
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
  /** End the session. */
  logout: () => Promise<void>
  /** Change the signed-in user's password. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  /** Load the data again, e.g. after an administrator changed rooms or organizations. */
  reload: () => void
  /** True while data is being (re)loaded, e.g. after navigating the calendar. */
  loading: boolean
  /** The calendar's visible period, so bookings can be loaded for it. */
  setVisibleRange: (range: DateRange) => void

  room: (id: string) => Room | undefined
  organization: (id: string) => Organization | undefined
  user: (id: string) => User | undefined
  /** The booking's room name and color, also when the room is archived and not in `data.rooms`. */
  roomOf: (booking: Booking) => RoomInfo

  /** One room's bookings in any period, also outside the loaded calendar range. Does not change `data`. */
  listBookings: (range: DateRange, roomId?: string) => Promise<Booking[]>
  createBooking: (input: CreateBookingInput) => Promise<Booking>
  approveBooking: (id: string, comment?: string) => Promise<Booking>
  rejectBooking: (id: string, reason: string) => Promise<Booking>
  cancelBooking: (id: string, reason?: string) => Promise<Booking>
  /** `original` is the booking as the user saw it when they started editing; its version is sent. */
  updateBooking: (original: Booking, input: UpdateBookingInput) => Promise<Booking>

  /** Weekly series. Preview, list and dry runs don't reload the data. */
  previewSeries: (input: CreateSeriesInput) => Promise<SeriesPreviewOccurrence[]>
  createSeries: (input: CreateSeriesInput) => Promise<SeriesCreated>
  listSeries: (seriesId: string) => Promise<Booking[]>
  /** Edits the occurrence `fromId` and the following ones. */
  /** `from` is the anchor occurrence as the user saw it when they started editing. */
  updateSeries: (from: Booking, input: UpdateBookingInput, options?: SeriesUpdateOptions) => Promise<SeriesUpdated>
  /** Every future occurrence, or with `fromId` that one and the following. */
  cancelSeries: (seriesId: string, options: { fromId?: string; reason?: string }) => Promise<Booking[]>
  approveSeries: (seriesId: string, comment?: string) => Promise<SeriesApproved>
  rejectSeries: (seriesId: string, reason: string) => Promise<Booking[]>

  /** Answer an invitation to an organization. Accepting reloads the data with the new membership. */
  acceptInvitation: (id: string) => Promise<void>
  declineInvitation: (id: string) => Promise<void>
  markDecisionsSeen: () => Promise<void>

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
