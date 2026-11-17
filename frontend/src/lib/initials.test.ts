import { describe, expect, it } from 'vitest'
import { initialsOf } from './initials'

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Kari Nordmann')).toBe('KN')
    expect(initialsOf('Ola Jakob Nordmann')).toBe('OJ')
  })

  it('skips words that do not start with a letter', () => {
    expect(initialsOf('Patrik (friByte)')).toBe('P')
    expect(initialsOf('  Åse   - Øvrebø ')).toBe('ÅØ')
  })

  it('upper-cases and falls back to the first character', () => {
    expect(initialsOf('emil')).toBe('E')
    expect(initialsOf('(123)')).toBe('(')
  })
})
