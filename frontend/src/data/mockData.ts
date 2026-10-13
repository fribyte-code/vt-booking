import { findConflicts } from '../services/bookingRules'
import type { Booking, AppData, Organization, Room, User } from '../types'

export const organizations: Organization[] = [
  { id: 'org-a', name: 'Organisasjon A', description: 'Studentforening for samfunnsfag' },
  { id: 'org-b', name: 'Organisasjon B', description: 'Linjeforening for økonomi' },
  { id: 'org-c', name: 'Organisasjon C', description: 'Studentavis og kulturutvalg' },
]

export const users: User[] = [
  { id: 'user-kari', name: 'Kari Nordmann', email: 'kari@example.no', role: 'USER', organizationIds: ['org-a'] },
  { id: 'user-ola', name: 'Ola Hansen', email: 'ola@example.no', role: 'USER', organizationIds: ['org-b'] },
  { id: 'user-ingrid', name: 'Ingrid Berg', email: 'ingrid@example.no', role: 'USER', organizationIds: ['org-c'] },
  {
    id: 'user-jonas',
    name: 'Jonas Lie',
    email: 'jonas@example.no',
    role: 'USER',
    organizationIds: ['org-a', 'org-c'],
  },
  { id: 'user-admin', name: 'Silje Aas', email: 'admin@example.no', role: 'ADMIN', organizationIds: [] },
]

export const rooms: Room[] = [
  {
    id: 'room-a',
    name: 'Møterom A',
    description: 'Lite møterom med skjerm og whiteboard.',
    location: '2. etasje',
    capacity: 8,
    color: '#2563eb',
    permissions: { 'org-a': 'DIRECT', 'org-b': 'DIRECT', 'org-c': 'NONE' },
  },
  {
    id: 'room-b',
    name: 'Møterom B',
    description: 'Møterom med videokonferanseutstyr.',
    location: '2. etasje',
    capacity: 12,
    color: '#0f766e',
    permissions: { 'org-a': 'REQUEST', 'org-b': 'NONE', 'org-c': 'DIRECT' },
  },
  {
    id: 'room-c',
    name: 'Storsalen',
    description: 'Stor sal med scene, lydanlegg og projektor.',
    location: '1. etasje',
    capacity: 150,
    color: '#7c3aed',
    permissions: { 'org-a': 'REQUEST', 'org-b': 'REQUEST', 'org-c': 'REQUEST' },
  },
]

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function mondayOf(date: Date): Date {
  const d = startOfDay(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function at(base: Date, dayOffset: number, time: string): string {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(base)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

/**
 * Builds the demo data set relative to `now`, so the calendar always has
 * activity in the current and coming weeks.
 */
export function createSeedData(now: Date = new Date()): AppData {
  const monday = mondayOf(now)
  const today = startOfDay(now)
  const created = new Date(now.getTime() - 3 * 86_400_000).toISOString()
  const decided = new Date(now.getTime() - 2 * 86_400_000).toISOString()

  type Seed = Omit<Booking, 'id' | 'createdAt' | 'requiresApproval' | 'status'> &
    Partial<Pick<Booking, 'status' | 'requiresApproval'>>

  const approvedFromRequest = {
    status: 'APPROVED' as const,
    requiresApproval: true,
    decidedAt: decided,
    decidedById: 'user-admin',
    decisionSeen: true,
  }

  // Approved bookings listed first take precedence if any of them overlap.
  const seeds: Seed[] = [
    // Relative to today, so the conflict demo is always in the future.
    {
      roomId: 'room-c', organizationId: 'org-c', requestedById: 'user-ingrid',
      title: 'Quizkveld', description: 'Åpen quiz for alle studenter.',
      start: at(today, 2, '18:00'), end: at(today, 2, '22:00'), ...approvedFromRequest,
    },
    // This week and next week, relative to Monday.
    {
      roomId: 'room-a', organizationId: 'org-a', requestedById: 'user-kari',
      title: 'Styremøte', description: 'Fast ukentlig styremøte.',
      start: at(monday, 0, '16:00'), end: at(monday, 0, '18:00'),
    },
    {
      roomId: 'room-a', organizationId: 'org-b', requestedById: 'user-ola',
      title: 'Økonomiutvalget', start: at(monday, 1, '12:15'), end: at(monday, 1, '13:00'),
    },
    {
      roomId: 'room-a', organizationId: 'org-a', requestedById: 'user-jonas',
      title: 'Semesterplanlegging', description: 'Planlegging av arrangementer til våren.',
      start: at(monday, 2, '10:00'), end: at(monday, 2, '11:30'),
    },
    {
      roomId: 'room-a', organizationId: 'org-b', requestedById: 'user-ola',
      title: 'Intervjuer – nye frivillige', start: at(monday, 3, '14:00'), end: at(monday, 3, '16:00'),
    },
    {
      roomId: 'room-a', organizationId: 'org-a', requestedById: 'user-kari',
      title: 'Styremøte', description: 'Fast ukentlig styremøte.',
      start: at(monday, 7, '16:00'), end: at(monday, 7, '18:00'),
    },
    {
      roomId: 'room-a', organizationId: 'org-b', requestedById: 'user-ola',
      title: 'Budsjettgjennomgang', start: at(monday, 9, '09:00'), end: at(monday, 9, '10:30'),
    },
    {
      roomId: 'room-b', organizationId: 'org-c', requestedById: 'user-ingrid',
      title: 'Redaksjonsmøte', start: at(monday, 0, '18:00'), end: at(monday, 0, '19:30'),
    },
    {
      roomId: 'room-b', organizationId: 'org-a', requestedById: 'user-kari',
      title: 'Workshop: søknadsskriving', description: 'Workshop for medlemmer om søknader til fond.',
      start: at(monday, 1, '17:00'), end: at(monday, 1, '19:00'), ...approvedFromRequest,
    },
    {
      roomId: 'room-b', organizationId: 'org-c', requestedById: 'user-jonas',
      title: 'Redaksjonsmøte', start: at(monday, 3, '18:00'), end: at(monday, 3, '19:30'),
    },
    {
      roomId: 'room-b', organizationId: 'org-c', requestedById: 'user-ingrid',
      title: 'Redaksjonsmøte', start: at(monday, 7, '18:00'), end: at(monday, 7, '19:30'),
    },
    {
      roomId: 'room-c', organizationId: 'org-b', requestedById: 'user-ola',
      title: 'Allmøte', description: 'Semesterets allmøte med valg av nytt styre.',
      start: at(monday, 4, '18:00'), end: at(monday, 4, '21:00'), ...approvedFromRequest,
    },
    {
      roomId: 'room-c', organizationId: 'org-a', requestedById: 'user-kari',
      title: 'Fagdag', description: 'Fagdag med eksterne foredragsholdere.',
      start: at(monday, 10, '10:00'), end: at(monday, 10, '15:00'), ...approvedFromRequest,
    },

    // Pending requests, all in the future.
    {
      roomId: 'room-c', organizationId: 'org-a', requestedById: 'user-kari',
      title: 'Debattmøte', description: 'Debatt om studentboliger med inviterte politikere.',
      start: at(today, 2, '19:00'), end: at(today, 2, '21:00'), status: 'PENDING',
    },
    {
      roomId: 'room-b', organizationId: 'org-a', requestedById: 'user-jonas',
      title: 'Prosjektgruppe', description: 'Arbeidsmøte for prosjektgruppen.',
      start: at(today, 1, '13:00'), end: at(today, 1, '15:00'), status: 'PENDING',
    },
    {
      roomId: 'room-c', organizationId: 'org-b', requestedById: 'user-ola',
      title: 'Filmkveld', start: at(today, 5, '17:00'), end: at(today, 5, '20:00'), status: 'PENDING',
    },
    {
      roomId: 'room-c', organizationId: 'org-c', requestedById: 'user-ingrid',
      title: 'Konsertøving', description: 'Generalprøve før vårkonserten.',
      start: at(today, 5, '18:00'), end: at(today, 5, '21:00'), status: 'PENDING',
    },
    {
      roomId: 'room-c', organizationId: 'org-a', requestedById: 'user-jonas',
      title: 'Rekrutteringsstand', start: at(today, 8, '11:00'), end: at(today, 8, '15:00'), status: 'PENDING',
    },

    // Processed requests for history.
    {
      roomId: 'room-c', organizationId: 'org-c', requestedById: 'user-ingrid',
      title: 'Øvingskveld band', start: at(today, 3, '19:00'), end: at(today, 3, '22:00'),
      status: 'REJECTED', requiresApproval: true, decidedAt: decided, decidedById: 'user-admin',
      decisionComment: 'Salen er satt av til rigging denne kvelden.', decisionSeen: false,
    },
    {
      roomId: 'room-a', organizationId: 'org-b', requestedById: 'user-ola',
      title: 'Kollokvie', start: at(today, 4, '10:00'), end: at(today, 4, '12:00'),
      status: 'CANCELLED', cancelledAt: decided, cancelledById: 'user-ola',
    },
  ]

  const bookings: Booking[] = []
  seeds.forEach((seed, i) => {
    const booking: Booking = {
      ...seed,
      id: `bk-seed-${i + 1}`,
      status: seed.status ?? 'APPROVED',
      requiresApproval: seed.requiresApproval ?? seed.status === 'PENDING',
      createdAt: created,
    }
    // Relative dates can collide depending on the weekday; never seed a double booking.
    if (booking.status === 'APPROVED' && findConflicts(bookings, booking.roomId, booking.start, booking.end).length) {
      return
    }
    bookings.push(booking)
  })

  return {
    users: structuredClone(users),
    organizations: structuredClone(organizations),
    rooms: structuredClone(rooms),
    bookings,
  }
}
