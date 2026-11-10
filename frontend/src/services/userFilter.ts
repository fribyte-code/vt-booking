import type { AdminOrganization, AdminUser } from './adminApi'

/** Brukere: no organization chosen, or users without any. */
export const ALL_ORGANIZATIONS = ''
export const NO_ORGANIZATION = '-'

/**
 * The users the list shows: the search matches name, email or the name of an organization they
 * belong to; `organizationId` keeps only members of that organization (or those without any).
 */
export function filterUsers(
  users: AdminUser[],
  organizations: Pick<AdminOrganization, 'id' | 'name'>[],
  query: string,
  organizationId: string = ALL_ORGANIZATIONS,
): AdminUser[] {
  const q = query.trim().toLowerCase()
  const names = new Map(organizations.map((o) => [o.id, o.name.toLowerCase()]))
  return users.filter(
    (u) =>
      (organizationId === ALL_ORGANIZATIONS ||
        (organizationId === NO_ORGANIZATION
          ? u.memberships.length === 0
          : u.memberships.some((m) => m.organizationId === organizationId))) &&
      (!q ||
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.memberships.some((m) => names.get(m.organizationId)?.includes(q))),
  )
}
