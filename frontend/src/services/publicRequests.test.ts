import { describe, expect, it } from 'vitest'
import type { Organization, Room } from '../types'
import { organizationsForRequest, roomForArea } from './publicRequests'

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
