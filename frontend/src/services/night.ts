import type { NightEvent, NightKind } from './adminApi'
import { formatPhone, type GuardsEvent, STUDENTVILLAEN } from './publicRequests'

/** The Natt tab's labels for the kinds of event. */
export const nightKindLabels: Record<NightKind, string> = {
  BOOKING: 'Booking',
  REQUEST: 'Søknad',
  PUBLIC_REQUEST: 'Forespørsel',
}

export const NIGHT_KINDS: NightKind[] = ['BOOKING', 'REQUEST', 'PUBLIC_REQUEST']

/** Which events the Natt tab lists. They come sorted by start. */
export interface NightFilter {
  /** One kind, or ALL. */
  kind: NightKind | 'ALL'
  /** A room id, or '' for every room. */
  roomId: string
  /** Only those without guards ordered. */
  withoutGuards: boolean
}

export const DEFAULT_NIGHT_FILTER: NightFilter = { kind: 'ALL', roomId: '', withoutGuards: false }

export function filterNight(events: NightEvent[], f: NightFilter): NightEvent[] {
  return events.filter(
    (e) =>
      (f.kind === 'ALL' || e.kind === f.kind) &&
      (!f.roomId || e.roomId === f.roomId) &&
      (!f.withoutGuards || !e.guardsOrderedAt),
  )
}

/** The guards' order for an event: the room in Studentvillaen, and who is responsible. */
export function guardsEventOfNight(e: NightEvent): GuardsEvent {
  return {
    title: e.title,
    organization: e.organizationName,
    place: e.roomName ? `${e.roomName}, ${STUDENTVILLAEN}` : STUDENTVILLAEN,
    start: e.start,
    end: e.end,
    contacts: e.contacts.map((c) =>
      c.phone ? `${c.name} (${c.organization}), tlf. ${formatPhone(c.phone)}` : `${c.name} (${c.organization})`,
    ),
  }
}
