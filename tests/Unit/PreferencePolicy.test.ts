import { describe, expect, it } from 'bun:test'
import { parsePreferenceChoice } from '../../app/Actions/Public/preference-policy'

describe('preference policy', () => {
  it('accepts JSON booleans and progressive-enhancement form values', () => {
    expect(parsePreferenceChoice(true)).toBe(true)
    expect(parsePreferenceChoice(false)).toBe(false)
    expect(parsePreferenceChoice('enabled')).toBe(true)
    expect(parsePreferenceChoice('disabled')).toBe(false)
    expect(parsePreferenceChoice('unchanged')).toBeNull()
  })
})
