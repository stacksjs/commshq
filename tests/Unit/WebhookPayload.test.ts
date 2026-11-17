import { describe, expect, it } from 'bun:test'
import { commerceEventType, objectPayload, webhookRecipient, woocommerceEventId } from '../../app/Support/webhookPayload'

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

  it('maps Shopify topics to the stable event vocabulary, and checkouts to carts', () => {
    expect(commerceEventType('shopify', 'orders/create')).toBe('order_created')
    expect(commerceEventType('shopify', 'orders/fulfilled')).toBe('order_fulfilled')
    expect(commerceEventType('shopify', 'fulfillments/create')).toBe('order_fulfilled')
    expect(commerceEventType('shopify', 'refunds/create')).toBe('order_refunded')
    expect(commerceEventType('shopify', 'checkouts/create')).toBe('cart')
    expect(commerceEventType('shopify', 'checkouts/update')).toBe('cart')
  })

  it('reads no other topic as an order', () => {
    // These all used to record another sale.
    for (const topic of ['orders/updated', 'orders/paid', 'orders/edited', 'orders/cancelled', 'carts/update', 'unknown'])
      expect(commerceEventType('shopify', topic)).toBeNull()
  })

  it('tells WooCommerce order updates apart by status', () => {
    expect(commerceEventType('woocommerce', 'order.created', { status: 'processing' })).toBe('order_created')
    expect(commerceEventType('woocommerce', 'order.updated', { status: 'refunded' })).toBe('order_refunded')
    expect(commerceEventType('woocommerce', 'order.updated', { status: 'completed' })).toBe('order_fulfilled')
    expect(commerceEventType('woocommerce', 'order.updated', { status: 'processing' })).toBeNull()
    expect(commerceEventType('woocommerce', 'order.deleted', { status: 'trash' })).toBeNull()
  })

  it('gives each WooCommerce change its own id, the same on redelivery', () => {
    const order = { id: 1001, date_modified_gmt: '2026-11-16T10:00:00' }
    const first = woocommerceEventId('https://shop.example', 'order.created', order, 'd1')
    expect(first).toMatch(/^wc_[0-9a-f]{64}$/)
    // Redelivered with a new delivery id: still the same change.
    expect(woocommerceEventId('https://shop.example', 'order.created', order, 'd2')).toBe(first)
    // A later change, another topic, or another store's order 1001: not the same.
    expect(woocommerceEventId('https://shop.example', 'order.created', { ...order, date_modified_gmt: '2026-11-16T11:00:00' }, 'd1')).not.toBe(first)
    expect(woocommerceEventId('https://shop.example', 'order.updated', order, 'd1')).not.toBe(first)
    expect(woocommerceEventId('https://other.example', 'order.created', order, 'd1')).not.toBe(first)
    // The ping a new webhook sends has no order, and still gets an id.
    expect(woocommerceEventId('https://shop.example', 'action.wc_ping', { webhook_id: '7' }, '')).toMatch(/^wc_[0-9a-f]{64}$/)
  })

  it('no longer takes the webhook id for the delivery id', async () => {
    const ingest = await Bun.file(new URL('../../app/Actions/Webhooks/IngestWebhookAction.ts', import.meta.url)).text()
    expect(ingest).not.toContain("headers.get('x-wc-webhook-id')")
    expect(ingest).toContain('woocommerceEventId(')
  })
})
