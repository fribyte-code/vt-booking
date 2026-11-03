import { describe, expect, it } from 'vitest'
import { combineEnd, crossesMidnight } from './dates'

// Local wall-clock times, so the tests don't depend on the machine's time zone.
const local = (s: string) => new Date(s).toISOString()

describe('bookings past midnight', () => {
  it('reads an end time at or before the start time as the next day', () => {
    expect(combineEnd('2030-03-10', '22:00', '02:00')).toBe(local('2030-03-11T02:00'))
    expect(combineEnd('2030-03-10', '22:00', '00:00')).toBe(local('2030-03-11T00:00'))
    expect(combineEnd('2030-03-10', '10:00', '10:00')).toBe(local('2030-03-11T10:00'))
    expect(combineEnd('2030-03-10', '10:00', '12:00')).toBe(local('2030-03-10T12:00'))
    expect(combineEnd('2030-12-31', '23:00', '01:00')).toBe(local('2031-01-01T01:00'))
  })

  it('detects bookings that go past midnight', () => {
    expect(crossesMidnight(local('2030-03-10T22:00'), local('2030-03-11T02:00'))).toBe(true)
    expect(crossesMidnight(local('2030-03-10T23:30'), local('2030-03-11T00:15'))).toBe(true)
    // Ending exactly at midnight stays within the day.
    expect(crossesMidnight(local('2030-03-10T22:00'), local('2030-03-11T00:00'))).toBe(false)
    expect(crossesMidnight(local('2030-03-11T00:00'), local('2030-03-11T02:00'))).toBe(false)
  })
})
