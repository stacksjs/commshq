import { describe, expect, it } from 'bun:test'
import { canDeliver, normalizedRecipient } from '../../app/Actions/Compliance/delivery-policy'

describe('delivery policy', () => {
  it('lets the latest consent decision win', () => {
    expect(canDeliver(null, [{ action: 'revoked', occurredAt: '2026-01-01' }, { action: 'confirmed', occurredAt: '2026-02-01' }])).toBe(true)
    expect(canDeliver(null, [{ action: 'confirmed', occurredAt: '2026-01-01' }, { action: 'unsubscribed', occurredAt: '2026-02-01' }])).toBe(false)
  })

  it('keeps an active suppression absolute across re-consent', () => {
    expect(canDeliver({}, [{ action: 'confirmed', occurredAt: '2026-02-01' }])).toBe(false)
  })

  it('normalizes channel recipients deterministically', () => {
    expect(normalizedRecipient('email', ' Maya@Example.COM ')).toBe('maya@example.com')
    expect(normalizedRecipient('sms', ' +1 (415) 555-0184 ')).toBe('+14155550184')
  })
})
