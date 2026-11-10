import { crossesMidnight, formatDate, formatTimeRange, toDateInput } from '../lib/dates'
import type { OpeningHoursEntry, Organization, Room } from '../types'
import type { PublicRequest, PublicRequestContact, PublicRequestStatus } from './adminApi'

export const MAX_CONTACTS = 10

/** A room offered in the public form (`GET /api/public/rooms`): active and marked by an admin. */
export interface PublicRoom {
  id: string
  name: string
  description: string | null
  capacity: number | null
  openingHours: OpeningHoursEntry[]
}

/** The room asked for, among the rooms the admin can book; none for no preference or a deleted room. */
export function requestedRoom(rooms: Room[], r: Pick<PublicRequest, 'preferredRoomId'>): Room | undefined {
  return r.preferredRoomId ? rooms.find((room) => room.id === r.preferredRoomId) : undefined
}

/**
 * The time and room that count for a request: its booking's, read live, when it has one (the
 * booking is the truth, also after a move in the calendar), otherwise the ones asked for.
 */
export function requestWhen(r: Pick<PublicRequest, 'start' | 'end' | 'preferredRoomName' | 'booking'>): {
  start: string
  end: string
  roomName: string | null
  booked: boolean
} {
  return r.booking
    ? { start: r.booking.start, end: r.booking.end, roomName: r.booking.roomName, booked: true }
    : { start: r.start, end: r.end, roomName: r.preferredRoomName, booked: false }
}

/** A contact person on one line, as in the booking description and replies. */
export function contactLine(c: PublicRequestContact): string {
  return `${c.name} (${c.organization}), kortnr. ${c.cardNumber}, tlf. ${c.phone}`
}

/**
 * The booking's description, prefilled from the request: the applicant's description first, then
 * the facts the booking should carry. Bookings allow 500 characters, so the description is cut
 * first and, with many contacts, the end of the facts.
 */
export function bookingDescription(r: PublicRequest): string {
  const facts = [
    `Kontakt: ${r.email}`,
    `Ønsket rom: ${r.preferredRoomName ?? 'Ingen preferanse'}`,
    `Medlem av Kulturstyret eller Studentersamfunnet: ${r.memberOfKulturstyretOrSamfunnet ? 'Ja' : 'Nei'}`,
    ...(r.contacts.length > 0 ? ['Ansvarlige:', ...r.contacts.map((c) => `- ${contactLine(c)}`)] : []),
  ].join('\n')
  const room = Math.max(0, 500 - facts.length - 2)
  return `${r.description.slice(0, room)}\n\n${facts}`.slice(0, 500)
}

export const emptyContact = (): PublicRequestContact => ({ name: '', organization: '', cardNumber: '', phone: '' })

const compact = (value: string) => value.replace(/[\s-]/g, '')

const CARD_NUMBER = /^[0-9]{4,20}$/
const PHONE = /^\+?[0-9]{8,15}$/

/** Card number and phone in the backend's format: digits only (phone optionally with + first). */
export const validCardNumber = (value: string) => CARD_NUMBER.test(compact(value))
export const validPhone = (value: string) => PHONE.test(compact(value))

/** Which of a contact person's fields are missing or invalid, so the form can mark exactly those. */
export function contactFieldProblems(c: PublicRequestContact): Record<keyof PublicRequestContact, boolean> {
  return {
    name: !c.name.trim(),
    organization: !c.organization.trim(),
    cardNumber: !validCardNumber(c.cardNumber),
    phone: !validPhone(c.phone),
  }
}

/**
 * Why a contact person can't be sent, or null. Same rules as the backend: everything filled in, a
 * card number of 4–20 digits (the UiB card number, not the student number) and a phone number of
 * 8–15 digits, optionally with + first. Spaces and hyphens are ignored.
 */
export function contactProblem(c: PublicRequestContact): string | null {
  if (!c.name.trim() || !c.organization.trim() || !c.cardNumber.trim() || !c.phone.trim()) {
    return 'Fyll ut navn, organisasjon, kortnummer og telefonnummer.'
  }
  if (!validCardNumber(c.cardNumber)) {
    return 'Kortnummeret skal bare ha sifre. Bruk nummeret på UiB-kortet, ikke studentnummeret.'
  }
  if (!validPhone(c.phone)) {
    return 'Telefonnummeret må ha 8–15 sifre, eventuelt med + foran.'
  }
  return null
}

const contactLabels: Record<keyof PublicRequestContact, string> = {
  name: 'navn',
  organization: 'organisasjon',
  cardNumber: 'kortnummer',
  phone: 'telefonnummer',
}

/** The empty fields of the contact persons, named for the form's error message ("kortnummer for person 2"). */
export function missingContactFields(contacts: PublicRequestContact[]): string[] {
  return contacts.flatMap((c, i) =>
    (Object.keys(contactLabels) as (keyof PublicRequestContact)[])
      .filter((field) => !c[field].trim())
      .map((field) => `${contactLabels[field]} for person ${i + 1}`),
  )
}

/** "a", "a og b", "a, b og c". */
export function listNorwegian(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} og ${items[items.length - 1]}`
}

/** A Norwegian phone number grouped for reading: "+47 912 34 567", "912 34 567"; anything else as given. */
export function formatPhone(phone: string): string {
  const m = /^(\+47)?(\d{3})(\d{2})(\d{3})$/.exec(compact(phone))
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : phone
}

/** The shared organization for public requests (created by migration V7), matched by name. */
export function isExternalOrganization(o: Organization): boolean {
  return o.name.trim().toLowerCase() === 'eksterne'
}

/**
 * The active organizations a public request can be booked for, "Eksterne" first and the rest by
 * name, and the one to preselect: "Eksterne", or none if it doesn't exist (the admin must choose).
 */
export function organizationsForRequest(organizations: Organization[]): { options: Organization[]; preselected: string } {
  const options = organizations
    .filter((o) => !o.archived)
    .sort((a, b) => Number(isExternalOrganization(b)) - Number(isExternalOrganization(a)) || a.name.localeCompare(b.name, 'nb'))
  return { options, preselected: options.find(isExternalOrganization)?.id ?? '' }
}

export const publicRequestStatusLabels: Record<PublicRequestStatus, string> = {
  NEW: 'Ubehandlet',
  IN_PROGRESS: 'Under arbeid',
  DONE: 'Ferdig',
  REJECTED: 'Avslått',
}

/** The chip tone of each status in the admin's list and details. */
export const publicRequestStatusTones: Record<PublicRequestStatus, 'dark' | 'amber' | 'default' | 'red'> = {
  NEW: 'dark',
  IN_PROGRESS: 'amber',
  DONE: 'default',
  REJECTED: 'red',
}

/** The calendar on a booking's day with the booking opened (read by CalendarPage). */
export function bookingCalendarLink(b: { id: string; start: string }): string {
  return `/?dato=${toDateInput(new Date(b.start))}&booking=${encodeURIComponent(b.id)}`
}

export const PUBLIC_REQUEST_STATUSES: PublicRequestStatus[] = ['NEW', 'IN_PROGRESS', 'DONE', 'REJECTED']

/** Not decided yet: a booking can be made from it, or it can be rejected. */
export const isOpenRequest = (r: Pick<PublicRequest, 'status'>) => r.status === 'NEW' || r.status === 'IN_PROGRESS'

/**
 * Which requests the Forespørsler tab lists: the open ones (ubehandlet and under arbeid), the done,
 * the rejected, or all. One at a time.
 */
export type PublicRequestView = 'OPEN' | 'DONE' | 'REJECTED' | 'ALL'

export const PUBLIC_REQUEST_VIEWS: PublicRequestView[] = ['OPEN', 'DONE', 'REJECTED', 'ALL']

export const publicRequestViewLabels: Record<PublicRequestView, string> = {
  OPEN: 'Åpne',
  DONE: 'Ferdig',
  REJECTED: 'Avslått',
  ALL: 'Alle',
}

export const inPublicRequestView = (r: Pick<PublicRequest, 'status'>, view: PublicRequestView) =>
  view === 'ALL' || (view === 'OPEN' ? isOpenRequest(r) : r.status === view)

/**
 * The view's requests in its order: open ones and all by the time that counts ({@link
 * requestWhen}, the booking's when there is one), soonest first; done and rejected ones by when
 * they were last handled, newest first.
 */
export function filterPublicRequests(requests: PublicRequest[], view: PublicRequestView): PublicRequest[] {
  const handled = (r: PublicRequest) => r.updatedAt ?? r.createdAt
  return requests
    .filter((r) => inPublicRequestView(r, view))
    .sort((a, b) =>
      view === 'DONE' || view === 'REJECTED'
        ? handled(b).localeCompare(handled(a))
        : requestWhen(a).start.localeCompare(requestWhen(b).start),
    )
}

const replyOpening: Record<PublicRequestStatus, string> = {
  NEW: 'Takk for forespørselen om å låne fellesareal i Studentvillaen.',
  IN_PROGRESS: 'Takk for forespørselen om å låne fellesareal i Studentvillaen.',
  DONE: 'Forespørselen om å låne fellesareal i Studentvillaen er godkjent.',
  REJECTED: 'Vi har dessverre ikke mulighet til å låne ut fellesareal i Studentvillaen til dette arrangementet.',
}

function formatWhen(start: string, end: string): string {
  return `${formatDate(start)}, ${formatTimeRange(start, end)}${crossesMidnight(start, end) ? ` (slutter ${formatDate(end)})` : ''}`
}

/**
 * A `mailto:` link that opens a reply to the applicant with subject and text filled in, worded
 * after the request's status. The admin edits it before sending; nothing is sent automatically.
 * A request with a booking (not rejected) names the room and time actually booked.
 */
export function replyMailto(r: PublicRequest): string {
  const details =
    r.booking && r.status !== 'REJECTED'
      ? [`Rom: ${r.booking.roomName}`, `Tidspunkt: ${formatWhen(r.booking.start, r.booking.end)}`]
      : [`Tidspunkt: ${formatWhen(r.start, r.end)}`, `Ønsket rom: ${r.preferredRoomName ?? 'Ingen preferanse'}`]
  const body = [
    'Hei,',
    '',
    replyOpening[r.status],
    '',
    `Arrangement: ${r.eventName}`,
    `Organisasjon: ${r.organizationName}`,
    ...details,
    ...(r.status === 'REJECTED' ? [] : ['', 'Husk at arrangementet må ha villavakt.']),
    '',
    '',
    '',
    'Med vennlig hilsen',
    'Velferdstinget Vest',
  ].join('\r\n')
  const subject = `Forespørsel om Studentvillaen: ${r.eventName}`
  // The address is left as is (validated by the server); some mail apps don't decode %40.
  return `mailto:${r.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/**
 * Where "Send til vektere" sends to. Empty: the admin fills in the address in the mail app.
 * Put the guard company's address here once it is known.
 */
export const GUARDS_EMAIL = ''

/** An event that needs guards, from a public request or a booking. */
export interface GuardsEvent {
  title: string
  organization: string
  place: string
  start: string
  end: string
  /** One line per responsible person, with phone where known. */
  contacts: string[]
}

export const STUDENTVILLAEN = 'Studentvillaen, Christies gate 18'

/** The guards' view of a public request: the room booked (or asked for) in Studentvillaen. */
export function guardsEventOfRequest(r: PublicRequest): GuardsEvent {
  const { start, end, roomName } = requestWhen(r)
  return {
    title: r.eventName,
    organization: r.organizationName,
    place: roomName ? `${roomName}, ${STUDENTVILLAEN}` : STUDENTVILLAEN,
    start,
    end,
    contacts: r.contacts.length
      ? r.contacts.map((c) => `${c.name} (${c.organization}), tlf. ${formatPhone(c.phone)}`)
      : [`${r.email}`],
  }
}

/**
 * "Send til vektere": a `mailto:` link with a ready-made order for guards, which the admin reads
 * through and sends from their own mail app. Nothing is sent by the system.
 */
export function guardsMailto(e: GuardsEvent, to: string = GUARDS_EMAIL): string {
  const subject = `Vektere ${formatDate(e.start, { weekday: false })}: ${e.title}`
  const body = [
    'Hei,',
    '',
    'Vi trenger vektere til et arrangement som går over midnatt.',
    '',
    `Arrangement: ${e.title}`,
    `Arrangør: ${e.organization}`,
    `Sted: ${e.place}`,
    `Tid: ${formatWhen(e.start, e.end)}`,
    '',
    'Ansvarlige under arrangementet:',
    ...e.contacts.map((c) => `- ${c}`),
    '',
    'Gi gjerne beskjed om dere kan stille, og hvor mange vektere dere setter opp.',
    '',
    'Med vennlig hilsen',
    'Velferdstinget Vest',
  ].join('\r\n')
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
