import { describe, expect, it } from 'vitest'
import type { NightEvent } from './adminApi'
import { filterNight, guardsEventOfNight } from './night'

const event = (id: string, patch: Partial<NightEvent> = {}): NightEvent => ({
  kind: 'BOOKING',
  bookingId: id,
  publicRequestId: null,
  seriesId: null,
  title: `Fest ${id}`,
  roomId: 'villaen',
  roomName: 'Villaen',
  organizationName: 'Org',
  start: '2030-03-01T21:00:00+01:00',
  end: '2030-03-02T02:00:00+01:00',
  contacts: [{ name: 'Kari', organization: 'Org', phone: null }],
  guardsOrderedAt: null,
  guardsOrderedByName: null,
  ...patch,
})

describe('night overview', () => {
  const all = [
    event('a'),
    event('b', { kind: 'REQUEST', roomId: 'engen', roomName: 'Engen', guardsOrderedAt: '2030-02-01T10:00:00Z' }),
    event('c', { kind: 'PUBLIC_REQUEST', bookingId: null, publicRequestId: 'r', roomId: null, roomName: null }),
  ]
  const ids = (f: Parameters<typeof filterNight>[1]) => filterNight(all, f).map((e) => e.title)

  it('filters by kind, room and guards, keeping the order', () => {
    expect(ids({ kinds: [], roomId: '', withoutGuards: false })).toEqual(['Fest a', 'Fest b', 'Fest c'])
    expect(ids({ kinds: ['REQUEST', 'PUBLIC_REQUEST'], roomId: '', withoutGuards: false })).toEqual(['Fest b', 'Fest c'])
    expect(ids({ kinds: [], roomId: 'engen', withoutGuards: false })).toEqual(['Fest b'])
    expect(ids({ kinds: [], roomId: '', withoutGuards: true })).toEqual(['Fest a', 'Fest c'])
  })

  it('orders guards with the room in Studentvillaen and the contacts, phone where known', () => {
    const order = guardsEventOfNight(event('d', { contacts: [{ name: 'Ola', organization: 'Jazz', phone: '+4791234567' }] }))
    expect(order.place).toBe('Villaen, Studentvillaen, Christies gate 18')
    expect(order.contacts).toEqual(['Ola (Jazz), tlf. +47 912 34 567'])
    expect(guardsEventOfNight(all[2]).place).toBe('Studentvillaen, Christies gate 18')
    expect(guardsEventOfNight(all[0]).contacts).toEqual(['Kari (Org)'])
  })
})
