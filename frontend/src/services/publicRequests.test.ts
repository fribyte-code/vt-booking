import { describe, expect, it } from 'vitest'
import type { Organization, Room } from '../types'
import type { PublicRequest } from './adminApi'
import { organizationsForRequest, replyMailto, roomForArea } from './publicRequests'

const room = (id: string, name: string) => ({ id, name }) as Room
const rooms = [room('1', 'Studentvillaen – kjeller'), room('2', ' festplassen '), room('3', 'Torgallmenningen')]

describe('roomForArea', () => {
  it('finds the room named after the area, ignoring case and spaces', () => {
    expect(roomForArea(rooms, 'FESTPLASSEN')?.id).toBe('2')
    expect(roomForArea(rooms, 'TORGALLMENNINGEN')?.id).toBe('3')
  })

  it('picks no room without a preference or a matching room', () => {
    expect(roomForArea(rooms, 'NO_PREFERENCE')).toBeUndefined()
    expect(roomForArea([room('1', 'Studentvillaen')], 'FESTPLASSEN')).toBeUndefined()
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
    preferredArea: 'FESTPLASSEN',
    start: '2030-03-01T19:00:00Z',
    end: '2030-03-02T01:00:00Z',
    description: 'Konsert',
    needsVillaGuard: true,
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
    expect(body).toContain('Ønsket fellesareal: Festplassen')
    expect(body).toContain('Behov for villavakt: Ja')
  })

  it('words the reply after the status', () => {
    expect(parse(replyMailto({ ...request, status: 'TRANSFERRED' })).body).toContain('er godkjent')
    const rejected = parse(replyMailto({ ...request, status: 'REJECTED' })).body
    expect(rejected).toContain('ikke mulighet')
    expect(rejected).toContain('Ønsket fellesareal: Festplassen')
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
