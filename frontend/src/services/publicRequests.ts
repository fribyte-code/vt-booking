import type { Organization, Room } from '../types'

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
