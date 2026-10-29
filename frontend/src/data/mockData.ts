import { findConflicts } from '../services/bookingRules'
import type { Booking, AppData, Organization, Room, User } from '../types'

export const organizations: Organization[] = [
  { id: 'org-kulturstyret', name: 'Kulturstyret i Bergen', description: 'Forvalter Studentvillaen og støtter studentkulturen i Bergen.' },
  { id: 'org-blak', name: 'Studentkoret Blandede Akademikere (BLAK)', description: 'Blandet studentkor.' },
  { id: 'org-mar', name: 'Mannskoret Arme Riddere (MAR)', description: 'Mannskor for studenter.' },
  { id: 'org-sirenene', name: 'Studinekoret Sirenene', description: 'Kor for studiner.' },
  { id: 'org-larmonien', name: 'Musikselskabet Larmonien', description: 'Studentorkester.' },
  { id: 'org-immaturus', name: 'Studentteateret Immaturus', description: 'Studentteater med fast scene i Blackbox.' },
]

export const users: User[] = [
  { id: 'user-kari', name: 'Kari Nordmann', email: 'kari@example.no', role: 'USER', organizationIds: ['org-blak'] },
  { id: 'user-ola', name: 'Ola Hansen', email: 'ola@example.no', role: 'USER', organizationIds: ['org-mar'] },
  { id: 'user-ingrid', name: 'Ingrid Berg', email: 'ingrid@example.no', role: 'USER', organizationIds: ['org-sirenene'] },
  {
    id: 'user-jonas',
    name: 'Jonas Lie',
    email: 'jonas@example.no',
    role: 'USER',
    organizationIds: ['org-blak', 'org-immaturus'],
  },
  { id: 'user-maria', name: 'Maria Solberg', email: 'maria@example.no', role: 'USER', organizationIds: ['org-larmonien'] },
  {
    id: 'user-henrik',
    name: 'Henrik Moe',
    email: 'henrik@example.no',
    role: 'USER',
    organizationIds: ['org-larmonien', 'org-mar'],
  },
  { id: 'user-emil', name: 'Emil Haugen', email: 'emil@example.no', role: 'USER', organizationIds: ['org-immaturus'] },
  { id: 'user-sofie', name: 'Sofie Dahl', email: 'sofie@example.no', role: 'USER', organizationIds: ['org-kulturstyret'] },
  { id: 'user-admin', name: 'Silje Aas', email: 'admin@example.no', role: 'ADMIN', organizationIds: [] },
]

/** Rooms in Studentvillaen, after kulturstyret.no/romoversikt. */
export const rooms: Room[] = [
  {
    id: 'room-marken',
    name: 'Marken',
    description: 'Møterom med skjerm. Organisasjoner i Kulturstyret har første prioritet.',
    location: 'Studentvillaen, 2. etasje',
    capacity: 10,
    color: '#2563eb',
    permissions: {
      'org-kulturstyret': 'DIRECT', 'org-blak': 'DIRECT', 'org-mar': 'DIRECT',
      'org-sirenene': 'DIRECT', 'org-larmonien': 'DIRECT', 'org-immaturus': 'DIRECT',
    },
  },
  {
    id: 'room-skansen',
    name: 'Skansen',
    description: 'Lite møterom for opptil fire personer.',
    location: 'Studentvillaen, 2. etasje',
    capacity: 4,
    color: '#0891b2',
    permissions: {
      'org-kulturstyret': 'DIRECT', 'org-blak': 'DIRECT', 'org-mar': 'DIRECT',
      'org-sirenene': 'DIRECT', 'org-larmonien': 'DIRECT', 'org-immaturus': 'DIRECT',
    },
  },
  {
    id: 'room-nostet',
    name: 'Nøstet',
    description: 'Møterom med åtte stoler og ekstra stoler ved behov.',
    location: 'Studentvillaen, 1. etasje',
    capacity: 8,
    color: '#0f766e',
    permissions: {
      'org-kulturstyret': 'DIRECT', 'org-blak': 'DIRECT', 'org-mar': 'DIRECT',
      'org-sirenene': 'DIRECT', 'org-larmonien': 'DIRECT', 'org-immaturus': 'DIRECT',
    },
  },
  {
    id: 'room-engen',
    name: 'Engen',
    description: 'Møterom reservert for DAK. Andre kan bare booke etter avtale.',
    location: 'Studentvillaen, 1. etasje',
    capacity: 8,
    color: '#65a30d',
    permissions: { 'org-kulturstyret': 'REQUEST' },
  },
  {
    id: 'room-festplassen',
    name: 'Festplassen',
    description: 'Fellesareal koblet til flere kontorer. Prioritert for Villa-organisasjoner, åpent utenom kontortid.',
    location: 'Studentvillaen, 2. etasje',
    capacity: 50,
    color: '#7c3aed',
    permissions: {
      'org-kulturstyret': 'REQUEST', 'org-blak': 'REQUEST', 'org-mar': 'REQUEST',
      'org-sirenene': 'REQUEST', 'org-larmonien': 'REQUEST', 'org-immaturus': 'REQUEST',
    },
  },
  {
    id: 'room-torgallmenningen',
    name: 'Torgallmenningen',
    description: 'Fellesareal som ofte lånes ut til arrangementer med eksterne deltakere uten nøkkelkort.',
    location: 'Studentvillaen, 2. etasje',
    capacity: 50,
    color: '#c026d3',
    permissions: {
      'org-kulturstyret': 'REQUEST', 'org-blak': 'REQUEST', 'org-mar': 'REQUEST',
      'org-sirenene': 'REQUEST', 'org-larmonien': 'REQUEST', 'org-immaturus': 'REQUEST',
    },
  },
  {
    id: 'room-korrommet',
    name: 'Korrommet',
    description: 'Øvingsrom. Larmonien, BLAK, MAR og Sirenene har rett på faste bookinger.',
    location: 'Studentvillaen, 1. etasje',
    color: '#db2777',
    permissions: {
      'org-kulturstyret': 'REQUEST', 'org-blak': 'DIRECT', 'org-mar': 'DIRECT',
      'org-sirenene': 'DIRECT', 'org-larmonien': 'DIRECT', 'org-immaturus': 'REQUEST',
    },
  },
  {
    id: 'room-kantinen',
    name: 'Gamle UiB-kantinen',
    description: 'For organisasjoner uten andre egnede lokaler, hovedsakelig kor. Hverdager 16–24, helg 08–16. Ingen alkohol.',
    location: 'Studentvillaen, 3. etasje',
    color: '#ea580c',
    permissions: {
      'org-blak': 'DIRECT', 'org-mar': 'DIRECT', 'org-sirenene': 'DIRECT', 'org-larmonien': 'REQUEST',
    },
  },
  {
    id: 'room-blackbox',
    name: 'Blackbox',
    description: 'Scene- og øvingsrom, hovedsakelig for studentteateret Immaturus.',
    location: 'Studentvillaen, 1. etasje',
    color: '#334155',
    permissions: {
      'org-kulturstyret': 'REQUEST', 'org-blak': 'REQUEST', 'org-mar': 'REQUEST',
      'org-sirenene': 'REQUEST', 'org-larmonien': 'REQUEST', 'org-immaturus': 'DIRECT',
    },
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
  // Times stay clear of the mornings, which the service tests book.
  const seeds: Seed[] = [
    // Relative to today, so the conflict demo is always in the future.
    {
      roomId: 'room-festplassen', organizationId: 'org-kulturstyret', requestedById: 'user-sofie',
      title: 'Kulturkveld', description: 'Åpen kveld der Villa-organisasjonene presenterer seg.',
      start: at(today, 2, '18:00'), end: at(today, 2, '22:00'), ...approvedFromRequest,
    },
    // Weekly rehearsals, this week and next week, relative to Monday.
    ...[0, 7].flatMap((week): Seed[] => [
      {
        roomId: 'room-kantinen', organizationId: 'org-sirenene', requestedById: 'user-ingrid',
        title: 'Korøvelse Sirenene', start: at(monday, week, '18:00'), end: at(monday, week, '21:00'),
      },
      {
        roomId: 'room-korrommet', organizationId: 'org-blak', requestedById: 'user-kari',
        title: 'Korøvelse BLAK', start: at(monday, week + 1, '18:00'), end: at(monday, week + 1, '21:00'),
      },
      {
        roomId: 'room-kantinen', organizationId: 'org-mar', requestedById: 'user-ola',
        title: 'Korøvelse MAR', start: at(monday, week + 2, '18:30'), end: at(monday, week + 2, '21:30'),
      },
      {
        roomId: 'room-korrommet', organizationId: 'org-larmonien', requestedById: 'user-maria',
        title: 'Orkesterøvelse', start: at(monday, week + 3, '19:00'), end: at(monday, week + 3, '22:00'),
      },
      {
        roomId: 'room-marken', organizationId: 'org-blak', requestedById: 'user-kari',
        title: 'Styremøte BLAK', description: 'Fast ukentlig styremøte.',
        start: at(monday, week, '16:00'), end: at(monday, week, '17:30'),
      },
    ]),
    {
      roomId: 'room-marken', organizationId: 'org-kulturstyret', requestedById: 'user-sofie',
      title: 'Tildelingsmøte', description: 'Behandling av søknader om kulturmidler.',
      start: at(monday, 2, '16:00'), end: at(monday, 2, '18:00'),
    },
    {
      roomId: 'room-skansen', organizationId: 'org-mar', requestedById: 'user-ola',
      title: 'Opptak av nye sangere', start: at(monday, 3, '12:00'), end: at(monday, 3, '14:00'),
    },
    {
      roomId: 'room-nostet', organizationId: 'org-sirenene', requestedById: 'user-ingrid',
      title: 'Styremøte Sirenene', start: at(monday, 1, '16:30'), end: at(monday, 1, '18:00'),
    },
    {
      roomId: 'room-nostet', organizationId: 'org-larmonien', requestedById: 'user-henrik',
      title: 'Notekomité', start: at(monday, 4, '15:00'), end: at(monday, 4, '16:30'),
    },
    {
      roomId: 'room-nostet', organizationId: 'org-immaturus', requestedById: 'user-jonas',
      title: 'Manusgjennomgang', start: at(monday, 8, '17:00'), end: at(monday, 8, '19:00'),
    },
    {
      roomId: 'room-blackbox', organizationId: 'org-immaturus', requestedById: 'user-emil',
      title: 'Prøve: vårforestilling', start: at(monday, 1, '17:00'), end: at(monday, 1, '21:00'),
    },
    {
      roomId: 'room-blackbox', organizationId: 'org-immaturus', requestedById: 'user-emil',
      title: 'Prøve: vårforestilling', start: at(monday, 3, '17:00'), end: at(monday, 3, '21:00'),
    },
    {
      roomId: 'room-blackbox', organizationId: 'org-immaturus', requestedById: 'user-jonas',
      title: 'Premiere', description: 'Premiere på Immaturus sin vårforestilling.',
      start: at(monday, 11, '19:00'), end: at(monday, 11, '22:00'),
    },
    {
      roomId: 'room-festplassen', organizationId: 'org-mar', requestedById: 'user-ola',
      title: 'Allmøte MAR', description: 'Semesterets allmøte med valg av nytt styre.',
      start: at(monday, 4, '18:00'), end: at(monday, 4, '21:00'), ...approvedFromRequest,
    },
    {
      roomId: 'room-torgallmenningen', organizationId: 'org-blak', requestedById: 'user-kari',
      title: 'Korseminar', description: 'Seminar med eksterne dirigenter og gjestesangere.',
      start: at(monday, 5, '11:00'), end: at(monday, 5, '16:00'), ...approvedFromRequest,
    },
    {
      roomId: 'room-kantinen', organizationId: 'org-larmonien', requestedById: 'user-maria',
      title: 'Seksjonsøvelse', start: at(monday, 12, '10:00'), end: at(monday, 12, '14:00'), ...approvedFromRequest,
    },

    // Pending requests, all in the future.
    {
      roomId: 'room-festplassen', organizationId: 'org-immaturus', requestedById: 'user-jonas',
      title: 'Åpen scene', description: 'Improvisasjonskveld for alle studenter.',
      start: at(today, 2, '19:00'), end: at(today, 2, '21:00'), status: 'PENDING',
    },
    {
      roomId: 'room-korrommet', organizationId: 'org-immaturus', requestedById: 'user-emil',
      title: 'Sangprøve til forestillingen', start: at(today, 1, '13:00'), end: at(today, 1, '15:00'), status: 'PENDING',
    },
    {
      roomId: 'room-torgallmenningen', organizationId: 'org-larmonien', requestedById: 'user-maria',
      title: 'Kammerkonsert', start: at(today, 5, '17:00'), end: at(today, 5, '20:00'), status: 'PENDING',
    },
    {
      roomId: 'room-torgallmenningen', organizationId: 'org-sirenene', requestedById: 'user-ingrid',
      title: 'Konsert med gjestekor', description: 'Felleskonsert med et besøkende kor.',
      start: at(today, 5, '18:00'), end: at(today, 5, '21:00'), status: 'PENDING',
    },
    {
      roomId: 'room-engen', organizationId: 'org-kulturstyret', requestedById: 'user-sofie',
      title: 'Søknadsverksted', description: 'Hjelp til organisasjoner som søker kulturmidler.',
      start: at(today, 8, '12:00'), end: at(today, 8, '14:00'), status: 'PENDING',
    },
    {
      roomId: 'room-blackbox', organizationId: 'org-blak', requestedById: 'user-kari',
      title: 'Konsertopptak', start: at(today, 6, '12:00'), end: at(today, 6, '15:00'), status: 'PENDING',
    },

    // Processed requests for history.
    {
      roomId: 'room-kantinen', organizationId: 'org-larmonien', requestedById: 'user-henrik',
      title: 'Ekstraøvelse', start: at(today, 3, '19:00'), end: at(today, 3, '22:00'),
      status: 'REJECTED', requiresApproval: true, decidedAt: decided, decidedById: 'user-admin',
      decisionComment: 'Kantinen er satt av til korene denne kvelden.', decisionSeen: false,
    },
    {
      roomId: 'room-skansen', organizationId: 'org-mar', requestedById: 'user-ola',
      title: 'Intervju', start: at(today, 4, '10:00'), end: at(today, 4, '11:00'),
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
