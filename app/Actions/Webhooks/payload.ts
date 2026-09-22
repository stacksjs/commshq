export function objectPayload(value: unknown): Record<string, any> {
  const payload = typeof value === 'string' ? JSON.parse(value) : value
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new TypeError('Stored webhook payload is invalid')
  return payload as Record<string, any>
}

export function webhookRecipient(payload: Record<string, any>): string {
  return String(payload.From || payload.from || payload.recipient || payload.email || '').trim().toLowerCase()
}

export function commerceEventType(type: unknown): 'order_created' | 'order_fulfilled' | 'order_refunded' {
  const value = String(type)
  if (value.includes('refund'))
    return 'order_refunded'
  if (value.includes('fulfill'))
    return 'order_fulfilled'
  return 'order_created'
}
