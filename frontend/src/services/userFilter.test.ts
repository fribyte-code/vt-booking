import { describe, expect, it } from 'vitest'
import type { AdminUser } from './adminApi'
import { filterUsers, NO_ORGANIZATION } from './userFilter'

const user = (name: string, orgs: string[]): AdminUser => ({
  id: name,
  email: `${name.toLowerCase()}@example.no`,
  displayName: name,
  globalRole: 'USER',
  status: 'ACTIVE',
  hasPassword: true,
  mustChangePassword: false,
  lastLoginAt: null,
  memberships: orgs.map((organizationId) => ({ organizationId, role: 'MEMBER' })),
})

describe('filterUsers', () => {
  const orgs = [
    { id: 'samf', name: 'Studentersamfunnet' },
    { id: 'jazz', name: 'Jazzklubben' },
  ]
  const users = [user('Kari', ['samf']), user('Ola', ['jazz', 'samf']), user('Per', [])]
  const names = (q: string, org?: string) => filterUsers(users, orgs, q, org).map((u) => u.displayName)

  it('searches name, email and organization names', () => {
    expect(names('')).toEqual(['Kari', 'Ola', 'Per'])
    expect(names('kari@')).toEqual(['Kari'])
    expect(names('jazz')).toEqual(['Ola'])
    expect(names('SAMFUNN')).toEqual(['Kari', 'Ola'])
  })

  it('filters by organization, or users without one', () => {
    expect(names('', 'jazz')).toEqual(['Ola'])
    expect(names('kari', 'jazz')).toEqual([])
    expect(names('', NO_ORGANIZATION)).toEqual(['Per'])
  })
})
