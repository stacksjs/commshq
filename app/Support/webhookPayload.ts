import { createHash } from 'node:crypto'

export function objectPayload(value: unknown): Record<string, any> {
  const payload = typeof value === 'string' ? JSON.parse(value) : value
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new TypeError('Stored webhook payload is invalid')
  return payload as Record<string, any>
}

export function webhookRecipient(payload: Record<string, any>): string {
  return String(payload.From || payload.from || payload.recipient || payload.email || '').trim().toLowerCase()
}

export type CommerceEventType = 'order_created' | 'order_fulfilled' | 'order_refunded'

/**
 * What a store's webhook is, from its provider, topic and body: one of the
 * three order events, `cart` for a Shopify checkout, or `null` for a topic
 * that is not read.
 *
 * Every topic used to be an order unless its name said refund or fulfil,
 * so a checkout update, an order edit or WooCommerce's `order.updated`
 * each recorded another sale. Now only the topics the Commerce page asks a
 * store to send are read, and anything else is accepted and left alone.
 *
 * WooCommerce has one topic for every change to an order, so its status
 * says which: `refunded` is a refund and `completed` a fulfilment. Any
 * other update is not an event.
 */
export function commerceEventType(provider: unknown, topic: unknown, payload: Record<string, any> = {}): CommerceEventType | 'cart' | null {
  const value = String(topic ?? '').trim().toLowerCase()
  if (String(provider) === 'woocommerce') {
    if (value === 'order.created')
      return 'order_created'
    if (value === 'order.updated') {
      const status = String(payload.status ?? '').toLowerCase()
      if (status === 'refunded')
        return 'order_refunded'
      if (status === 'completed')
        return 'order_fulfilled'
    }
    return null
  }
  if (value === 'orders/create')
    return 'order_created'
  if (value === 'orders/fulfilled' || value === 'fulfillments/create')
    return 'order_fulfilled'
  if (value === 'refunds/create')
    return 'order_refunded'
  if (value === 'checkouts/create' || value === 'checkouts/update')
    return 'cart'
  return null
}

/**
 * A WooCommerce delivery's identity, the same on every redelivery of it.
 *
 * `X-WC-Webhook-ID` names the webhook, not the delivery: every order a
 * store sent through one webhook carried the same id, so each after the
 * first was taken for a duplicate and dropped. The order's id, the topic
 * and the moment the order last changed say which change this is; the
 * store's address keeps two stores' order 1001 apart. Hashed, because a
 * store's address has no length limit and the column has.
 *
 * Existing rows keep the old ids; a new one can never equal one, so a
 * store's next order is not mistaken for anything already received.
 */
export function woocommerceEventId(source: unknown, topic: unknown, payload: Record<string, any>, deliveryId: unknown): string {
  const id = payload?.id
  // No order in it: the ping WooCommerce sends when a webhook is saved,
  // which names the webhook and nothing else.
  const parts = id === undefined || id === null || id === ''
    ? [source, topic, 'delivery', deliveryId, payload?.webhook_id]
    : [source, topic, id, payload.date_modified_gmt ?? payload.date_modified]
  return `wc_${createHash('sha256').update(parts.map(part => String(part ?? '')).join('|')).digest('hex')}`
}
