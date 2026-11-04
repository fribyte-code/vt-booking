import { crossesMidnight, formatDate, formatTimeRange } from '../lib/dates'
import type { Organization, Room } from '../types'
import type { PublicRequest } from './adminApi'

/** The common area a public request is for. Only Festplassen and Torgallmenningen are offered for now. */
export type PreferredArea = 'FESTPLASSEN' | 'TORGALLMENNINGEN' | 'NO_PREFERENCE'

/** The form's options. The priority notes are guidance only; the admin decides. */
export const preferredAreas: { value: PreferredArea; label: string; hint?: string }[] = [
  { value: 'FESTPLASSEN', label: 'Festplassen', hint: 'Ca. 50 personer. Villaorganisasjoner prioriteres.' },
  { value: 'TORGALLMENNINGEN', label: 'Torgallmenningen', hint: 'Ca. 50 personer. Eksterne organisasjoner prioriteres.' },
  { value: 'NO_PREFERENCE', label: 'Ingen preferanse' },
]

export function preferredAreaLabel(area: PreferredArea): string {
  return preferredAreas.find((a) => a.value === area)?.label ?? area
}

/**
 * The room for the requested area: the room with the area's name (case and surrounding spaces
 * ignored). None for "Ingen preferanse" or when no room has that name; the admin picks one then.
 */
export function roomForArea(rooms: Room[], area: PreferredArea): Room | undefined {
  if (area === 'NO_PREFERENCE') return undefined
  const name = preferredAreaLabel(area).toLowerCase()
  return rooms.find((r) => r.name.trim().toLowerCase() === name)
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
    : [`Tidspunkt: ${formatWhen(r.start, r.end)}`, `Ønsket fellesareal: ${preferredAreaLabel(r.preferredArea)}`]
  const body = [
    'Hei,',
    '',
    replyOpening[r.status],
    '',
    `Arrangement: ${r.eventName}`,
    `Organisasjon: ${r.organizationName}`,
    ...details,
    `Behov for villavakt: ${r.needsVillaGuard ? 'Ja' : 'Nei'}`,
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
