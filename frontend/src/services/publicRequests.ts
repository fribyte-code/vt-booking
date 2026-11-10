import { crossesMidnight, formatDate, formatTimeRange } from '../lib/dates'
import type { OpeningHoursEntry, Organization, Room } from '../types'
import type { PublicRequest, PublicRequestContact } from './adminApi'

/** Same as the backend: 07:00 to 05:00 the next day is the longest the closed hours (05:00–07:00) leave. */
export const PUBLIC_REQUEST_MAX_HOURS = 22
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

const replyOpening: Record<PublicRequest['status'], string> = {
  NEW: 'Takk for forespørselen om å låne fellesareal i Studentvillaen.',
  TRANSFERRED: 'Forespørselen om å låne fellesareal i Studentvillaen er godkjent.',
  REJECTED: 'Vi har dessverre ikke mulighet til å låne ut fellesareal i Studentvillaen til dette arrangementet.',
}

/** The booking a transferred request became, as far as the loaded data has it. */
export interface TransferredBooking {
  roomName: string
  start: string
  end: string
}

function formatWhen(start: string, end: string): string {
  return `${formatDate(start)}, ${formatTimeRange(start, end)}${crossesMidnight(start, end) ? ` (slutter ${formatDate(end)})` : ''}`
}

/**
 * A `mailto:` link that opens a reply to the applicant with subject and text filled in, worded
 * after the request's status. The admin edits it before sending; nothing is sent automatically.
 * A transferred request shows the room and time actually booked (the admin may have changed
 * them); if that booking isn't loaded, no room is named and the time is marked as requested.
 */
export function replyMailto(r: PublicRequest, booking?: TransferredBooking): string {
  const transferred = r.status === 'TRANSFERRED'
  const details = transferred
    ? booking
      ? [`Rom: ${booking.roomName}`, `Tidspunkt: ${formatWhen(booking.start, booking.end)}`]
      : [`Ønsket tidspunkt: ${formatWhen(r.start, r.end)}`]
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
