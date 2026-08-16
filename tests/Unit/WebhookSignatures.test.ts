import { describe, expect, it } from 'bun:test'
import { createHmac } from 'node:crypto'
import { providerSignatureHeader, verifyHmac, verifyStripeSignature } from '../../app/Actions/Webhooks/signatures'

describe('webhook signatures', () => {
  it('accepts valid hex and base64 HMAC signatures', () => {
    const payload = '{"id":"evt_1"}'
    const secret = 'secret'
    expect(verifyHmac(payload, createHmac('sha256', secret).update(payload).digest('hex'), secret)).toBe(true)
    expect(verifyHmac(payload, createHmac('sha256', secret).update(payload).digest('base64'), secret, 'base64')).toBe(true)
  })

  it('rejects stale Stripe signatures', () => {
    const payload = '{}'
    const secret = 'whsec_test'
    const timestamp = 1_700_000_000
    const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
    expect(verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret, timestamp + 30)).toBe(true)
    expect(verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret, timestamp + 301)).toBe(false)
  })

  it('uses provider-native header names', () => {
    expect(providerSignatureHeader('shopify', new Headers({ 'x-shopify-hmac-sha256': 'abc' }))).toBe('abc')
    expect(providerSignatureHeader('generic', new Headers({ 'x-commshq-signature': 'xyz' }))).toBe('xyz')
  })
})
