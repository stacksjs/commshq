import { createHmac, timingSafeEqual } from 'node:crypto'

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function verifyHmac(
  payload: string,
  signature: string,
  secret: string,
  encoding: 'hex' | 'base64' = 'hex',
): boolean {
  if (!payload || !signature || !secret) return false
  const normalized = signature.replace(/^sha256=/i, '').trim()
  const expected = createHmac('sha256', secret).update(payload).digest(encoding)
  return safeEqual(normalized, expected)
}

export function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  const fields = Object.fromEntries(header.split(',').map((part) => {
    const [key, value] = part.split('=', 2)
    return [key?.trim(), value?.trim()]
  }))
  const timestamp = Number(fields.t)
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false
  return verifyHmac(`${timestamp}.${payload}`, fields.v1 || '', secret)
}

export function providerSignatureHeader(provider: string, headers: Headers): string {
  if (provider === 'stripe') return headers.get('stripe-signature') || ''
  if (provider === 'shopify') return headers.get('x-shopify-hmac-sha256') || ''
  if (provider === 'woocommerce') return headers.get('x-wc-webhook-signature') || ''
  if (provider === 'twilio') return headers.get('x-twilio-signature') || ''
  if (provider === 'mail') return headers.get('x-mail-signature') || ''
  return headers.get('x-commshq-signature') || ''
}
