import { describe, expect, it } from 'bun:test'
import { commerceEventType, objectPayload, webhookRecipient } from '../../app/Actions/Webhooks/payload'

describe('webhook payload normalization', () => {
  it('accepts stored JSON and object payloads', () => {
    expect(objectPayload('{"id":"evt_1"}')).toEqual({ id: 'evt_1' })
    expect(objectPayload({ id: 'evt_2' })).toEqual({ id: 'evt_2' })
  })

  it('rejects values that cannot be provider events', () => {
    expect(() => objectPayload(null)).toThrow('Stored webhook payload is invalid')
    expect(() => objectPayload([])).toThrow('Stored webhook payload is invalid')
    expect(() => objectPayload('not-json')).toThrow()
  })

  it('normalizes provider-specific recipient fields', () => {
    expect(webhookRecipient({ From: ' +1 (415) 555-0184 ' })).toBe('+1 (415) 555-0184')
    expect(webhookRecipient({ email: ' Maya@Example.COM ' })).toBe('maya@example.com')
  })

  it('maps commerce topics to the stable event vocabulary', () => {
    expect(commerceEventType('orders/create')).toBe('order_created')
    expect(commerceEventType('orders/fulfilled')).toBe('order_fulfilled')
    expect(commerceEventType('refunds/create')).toBe('order_refunded')
  })
})
