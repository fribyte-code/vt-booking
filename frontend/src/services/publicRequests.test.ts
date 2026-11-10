import { describe, expect, it } from 'vitest'
import type { Organization, Room } from '../types'
import type { PublicRequest } from './adminApi'
import {
  bookingDescription,
  contactFieldProblems,
  contactProblem,
  formatPhone,
  listNorwegian,
  missingContactFields,
  organizationsForRequest,
  replyMailto,
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
    expect(parse(replyMailto({ ...request, status: 'TRANSFERRED' })).body).toContain('er godkjent')
    const rejected = parse(replyMailto({ ...request, status: 'REJECTED' })).body
    expect(rejected).toContain('ikke mulighet')
    expect(rejected).toContain('Ønsket rom: Festplassen')
    expect(rejected).not.toContain('villavakt')
  })

  it('names the room actually booked for a transferred request, not the one asked for', () => {
    const transferred = { ...request, status: 'TRANSFERRED' as const, bookingId: 'b1' }
    const booked = parse(
      replyMailto(transferred, { roomName: 'Torgallmenningen', start: '2030-03-01T20:00:00Z', end: '2030-03-01T23:00:00Z' }),
    ).body
    expect(booked).toContain('Rom: Torgallmenningen')
    expect(booked).not.toContain('Festplassen')
    expect(booked).not.toContain('Ønsket')

    // Without the booking at hand, no room is named, and the time is the one asked for.
    const unknown = parse(replyMailto(transferred)).body
    expect(unknown).not.toMatch(/Rom:|Festplassen|Torgallmenningen/)
    expect(unknown).toContain('Ønsket tidspunkt:')
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
