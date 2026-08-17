import { describe, expect, it } from 'bun:test'
import { canGenerateAi, estimateTokens, parseAiPurpose, validAiPrompt, validIdempotencyKey } from '../../app/Actions/Ai/generation-policy'

describe('AI generation policy', () => {
  it('limits generation and review to publishing roles', () => {
    expect(canGenerateAi('owner')).toBe(true)
    expect(canGenerateAi('admin')).toBe(true)
    expect(canGenerateAi('editor')).toBe(true)
    expect(canGenerateAi('viewer')).toBe(false)
  })

  it('accepts only declared purposes and bounded prompts', () => {
    expect(parseAiPurpose('writing')).toBe('writing')
    expect(parseAiPurpose('unknown')).toBeNull()
    expect(validAiPrompt('Write a concise welcome message for new readers.')).not.toBeNull()
    expect(validAiPrompt('Too short')).toBeNull()
    expect(validAiPrompt('x'.repeat(8_001))).toBeNull()
  })

  it('requires a bounded transport-safe idempotency key', () => {
    expect(validIdempotencyKey('draft:welcome:01J123456789')).toBe('draft:welcome:01J123456789')
    expect(validIdempotencyKey('short')).toBeNull()
    expect(validIdempotencyKey('x'.repeat(201))).toBeNull()
    expect(validIdempotencyKey('draft key with spaces')).toBeNull()
  })

  it('uses a stable conservative token estimate', () => {
    expect(estimateTokens('')).toBe(1)
    expect(estimateTokens('12345')).toBe(2)
  })
})
