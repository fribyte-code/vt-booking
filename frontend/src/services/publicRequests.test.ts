import { describe, expect, it } from 'vitest'
import type { Organization, Room } from '../types'
import type { PublicRequest } from './adminApi'
import {
  bookingDescription,
  contactFieldProblems,
  contactProblem,
  filterPublicRequests,
  formatPhone,
  guardsEventOfRequest,
  guardsMailto,
  listNorwegian,
  missingContactFields,
  organizationsForRequest,
  replyMailto,
  requestWhen,
  requestedRoom,
} from './publicRequests'

const room = (id: string, name: string) => ({ id, name }) as Room
const rooms = [room('1', 'Studentvillaen – kjeller'), room('2', ' festplassen '), room('3', 'Torgallmenningen')]

describe('requestedRoom', () => {
  it('finds the room asked for by id, and none without a preference or when it is gone', () => {
    expect(requestedRoom(rooms, { preferredRoomId: '2' })?.name).toBe(' festplassen ')
    expect(requestedRoom(rooms, { preferredRoomId: null })).toBeUndefined()
    expect(requestedRoom(rooms, { preferredRoomId: 'slettet' })).toBeUndefined()
  })
})

describe('contactProblem', () => {
  const contact = { name: 'Kari', organization: 'Jazzklubben', cardNumber: '1234 5678', phone: '+47 912 34 567' }

  it('accepts a complete contact, ignoring spaces and hyphens', () => {
    expect(contactProblem(contact)).toBeNull()
    expect(contactProblem({ ...contact, phone: '912-34-567' })).toBeNull()
  })

  it('refuses missing fields, a student number and a short phone number', () => {
    expect(contactProblem({ ...contact, name: ' ' })).toMatch(/Fyll ut/)
    expect(contactProblem({ ...contact, cardNumber: 's123456' })).toMatch(/ikke studentnummeret/)
    expect(contactProblem({ ...contact, phone: '112' })).toMatch(/Telefonnummeret/)
  })
})

describe('organizationsForRequest', () => {
  const org = (id: string, name: string, archived?: boolean): Organization => ({ id, name, description: '', archived })

  it('lists active organizations with "Eksterne" first and preselected', () => {
    const { options, preselected } = organizationsForRequest([
      org('b', 'Studentersamfunnet'),
      org('old', 'Arkivert forening', true),
      org('ext', 'Eksterne'),
      org('a', 'Kulturstyret'),
    ])
    expect(options.map((o) => o.id)).toEqual(['ext', 'a', 'b'])
    expect(preselected).toBe('ext')
  })

  it('preselects nothing without an active "Eksterne"', () => {
    const { options, preselected } = organizationsForRequest([org('a', 'Kulturstyret'), org('b', 'Eksterne', true)])
    expect(options.map((o) => o.id)).toEqual(['a'])
    expect(preselected).toBe('')
  })
})

describe('replyMailto', () => {
  const request: PublicRequest = {
    id: 'r1',
    email: 'leder@example.no',
    organizationName: 'Jazzklubben',
    eventName: 'Høstkonsert & fest',
    memberOfKulturstyretOrSamfunnet: false,
    preferredRoomId: '2',
    preferredRoomName: 'Festplassen',
    start: '2030-03-01T19:00:00Z',
    end: '2030-03-02T01:00:00Z',
    description: 'Konsert',
    contacts: [{ name: 'Kari', organization: 'Jazzklubben', cardNumber: '12345678', phone: '91234567' }],
    status: 'NEW',
    createdAt: '2030-02-01T10:00:00Z',
    bookingId: null,
    booking: null,
    bookingRemovedAt: null,
    updatedAt: null,
    updatedByName: null,
  }
  const parse = (link: string) => {
    const url = new URL(link)
    return { to: decodeURIComponent(url.pathname), subject: url.searchParams.get('subject'), body: url.searchParams.get('body') ?? '' }
  }

  it('fills in the recipient, subject and the request in the text, safely encoded', () => {
    const { to, subject, body } = parse(replyMailto(request))
    expect(to).toBe('leder@example.no')
    expect(subject).toBe('Forespørsel om Studentvillaen: Høstkonsert & fest')
    expect(body).toContain('Takk for forespørselen')
    expect(body).toContain('Arrangement: Høstkonsert & fest')
    expect(body).toContain('Ønsket rom: Festplassen')
    expect(body).toContain('må ha villavakt')
  })

  it('words the reply after the status', () => {
    expect(parse(replyMailto({ ...request, status: 'DONE' })).body).toContain('er godkjent')
    const rejected = parse(replyMailto({ ...request, status: 'REJECTED' })).body
    expect(rejected).toContain('ikke mulighet')
    expect(rejected).toContain('Ønsket rom: Festplassen')
    expect(rejected).not.toContain('villavakt')
  })

  it('names the room and time of the booking, which counts over what was asked for', () => {
    const transferred: PublicRequest = {
      ...request,
      status: 'DONE',
      bookingId: 'b1',
      booking: {
        id: 'b1',
        roomId: '3',
        roomName: 'Torgallmenningen',
        title: 'Konsert',
        start: '2030-03-01T20:00:00Z',
        end: '2030-03-01T23:00:00Z',
        status: 'APPROVED',
      },
    }
    const booked = parse(replyMailto(transferred)).body
    expect(booked).toContain('Rom: Torgallmenningen')
    expect(booked).not.toContain('Festplassen')
    expect(booked).not.toContain('Ønsket')
    expect(requestWhen(transferred)).toEqual({
      start: '2030-03-01T20:00:00Z',
      end: '2030-03-01T23:00:00Z',
      roomName: 'Torgallmenningen',
      booked: true,
    })
    expect(requestWhen(request)).toMatchObject({ start: request.start, roomName: 'Festplassen', booked: false })
  })
})

describe('bookingDescription', () => {
  const request = {
    email: 'leder@example.no',
    memberOfKulturstyretOrSamfunnet: true,
    preferredRoomName: null,
    description: 'x'.repeat(600),
    contacts: Array.from({ length: 3 }, (_, i) => ({ name: `Person ${i}`, organization: 'Org', cardNumber: '12345678', phone: '91234567' })),
  } as unknown as PublicRequest

  it('keeps the facts and contacts, and stays within 500 characters', () => {
    const text = bookingDescription(request)
    expect(text.length).toBeLessThanOrEqual(500)
    expect(text).toContain('Ønsket rom: Ingen preferanse')
    expect(text).toContain('- Person 2 (Org), kortnr. 12345678, tlf. 91234567')
  })
})

describe('form messages', () => {
  const empty = { name: '', organization: '', cardNumber: '', phone: '' }
  const filled = { name: 'Kari', organization: 'Jazzklubben', cardNumber: '12345678', phone: '91234567' }

  it('names the missing contact fields per person', () => {
    expect(missingContactFields([filled, { ...empty, name: 'Ola' }])).toEqual([
      'organisasjon for person 2',
      'kortnummer for person 2',
      'telefonnummer for person 2',
    ])
  })

  it('marks exactly the fields that are missing or invalid', () => {
    expect(contactFieldProblems({ ...filled, cardNumber: 's123456' })).toEqual({
      name: false,
      organization: false,
      cardNumber: true,
      phone: false,
    })
    expect(contactFieldProblems({ ...filled, phone: '112' }).phone).toBe(true)
  })

  it('joins lists the Norwegian way', () => {
    expect(listNorwegian(['dato'])).toBe('dato')
    expect(listNorwegian(['dato', 'beskrivelse'])).toBe('dato og beskrivelse')
    expect(listNorwegian(['a', 'b', 'c'])).toBe('a, b og c')
  })

  it('groups Norwegian phone numbers and leaves others as they are', () => {
    expect(formatPhone('+4791234567')).toBe('+47 912 34 567')
    expect(formatPhone('91234567')).toBe('912 34 567')
    expect(formatPhone('+46701234567')).toBe('+46701234567')
  })
})

describe('handling status and guards', () => {
  const base = {
    email: 'a@example.no',
    organizationName: 'Org',
    eventName: 'Fest',
    memberOfKulturstyretOrSamfunnet: false,
    preferredRoomId: null,
    preferredRoomName: 'Festplassen',
    description: '',
    contacts: [{ name: 'Kari', organization: 'Org', cardNumber: '12345678', phone: '+4791234567' }],
    bookingId: null,
    booking: null,
    bookingRemovedAt: null,
    updatedAt: null,
    updatedByName: null,
  }
  const req = (id: string, status: PublicRequest['status'], start: string, end: string, createdAt: string): PublicRequest => ({
    ...base,
    id,
    status,
    start,
    end,
    createdAt,
  })
  const all = [
    req('night', 'NEW', '2030-03-02T20:00:00+01:00', '2030-03-03T02:00:00+01:00', '2030-02-01T10:00:00Z'),
    req('day', 'IN_PROGRESS', '2030-03-01T12:00:00+01:00', '2030-03-01T14:00:00+01:00', '2030-02-03T10:00:00Z'),
    req('done', 'DONE', '2030-02-20T12:00:00+01:00', '2030-02-20T14:00:00+01:00', '2030-02-02T10:00:00Z'),
  ]

  it('filters and sorts by the booked time when there is a booking', () => {
    // Asked for the afternoon, booked over midnight in the calendar.
    const moved: PublicRequest = {
      ...all[2],
      booking: {
        id: 'b',
        roomId: 'x',
        roomName: 'Torgallmenningen',
        title: 'Fest',
        start: '2030-03-04T22:00:00+01:00',
        end: '2030-03-05T01:00:00+01:00',
        status: 'APPROVED',
      },
    }
    const ids = (f: Parameters<typeof filterPublicRequests>[1]) => filterPublicRequests([...all.slice(0, 2), moved], f).map((r) => r.id)
    expect(ids({ statuses: [], nightOnly: true, sort: 'start' })).toEqual(['night', 'done'])
    expect(ids({ statuses: [], nightOnly: false, sort: 'start' })).toEqual(['day', 'night', 'done'])
  })

  it('filters by status and past midnight, sorted by start or by received', () => {
    const ids = (f: Parameters<typeof filterPublicRequests>[1]) => filterPublicRequests(all, f).map((r) => r.id)
    expect(ids({ statuses: ['NEW', 'IN_PROGRESS'], nightOnly: false, sort: 'start' })).toEqual(['day', 'night'])
    expect(ids({ statuses: [], nightOnly: false, sort: 'received' })).toEqual(['day', 'done', 'night'])
    expect(ids({ statuses: [], nightOnly: true, sort: 'start' })).toEqual(['night'])
  })

  it('fills in an order for guards with place, time and contacts', () => {
    const link = guardsMailto(guardsEventOfRequest(all[0]), 'vakt@example.no')
    const url = new URL(link)
    const body = url.searchParams.get('body') ?? ''
    expect(decodeURIComponent(url.pathname)).toBe('vakt@example.no')
    expect(url.searchParams.get('subject')).toContain('Fest')
    expect(body).toContain('Sted: Festplassen, Studentvillaen, Christies gate 18')
    expect(body).toContain('(slutter')
    expect(body).toContain('- Kari (Org), tlf. +47 912 34 567')
  })
})
