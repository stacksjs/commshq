import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { job } from '@stacksjs/queue'
import { response } from '@stacksjs/router'
import { verifyTwilioWebhook } from '@stacksjs/sms'
import WebhookEndpoint from '../../Models/WebhookEndpoint'
import WebhookEvent from '../../Models/WebhookEvent'
import { providerSignatureHeader, verifyHmac, verifyStripeSignature } from './signatures'
import { twilioComplianceXml } from './twilio-compliance'

const SUPPORTED_PROVIDERS = new Set(['twilio', 'stripe', 'shopify', 'woocommerce', 'mail', 'generic'])

function eventId(provider: string, headers: Headers, payload: Record<string, any>): string {
  if (provider === 'shopify') return headers.get('x-shopify-webhook-id') || String(payload.id || '')
  if (provider === 'woocommerce') return headers.get('x-wc-webhook-id') || String(payload.id || '')
  if (provider === 'mail') return headers.get('x-mail-event-id') || String(payload.id || payload.messageId || '')
  if (provider === 'twilio') return String(payload.MessageSid || payload.SmsSid || '')
  return String(payload.id || headers.get('x-commshq-event-id') || '')
}

function eventType(provider: string, headers: Headers, payload: Record<string, any>): string {
  if (provider === 'shopify') return headers.get('x-shopify-topic') || 'unknown'
  if (provider === 'woocommerce') return headers.get('x-wc-webhook-topic') || 'unknown'
  if (provider === 'twilio') return String(payload.MessageStatus ? `sms.${payload.MessageStatus}` : 'sms.inbound')
  return String(payload.type || headers.get('x-mail-event-type') || 'unknown')
}

function parsedBody(raw: string, contentType: string): Record<string, any> {
  if (contentType.includes('application/x-www-form-urlencoded'))
    return Object.fromEntries(new URLSearchParams(raw))
  const value = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Webhook body must be an object')
  return value
}

function signatureIsValid(provider: string, requestUrl: string, raw: string, body: Record<string, any>, headers: Headers, secret: string): boolean {
  const signature = providerSignatureHeader(provider, headers)
  if (provider === 'stripe') return verifyStripeSignature(raw, signature, secret)
  if (provider === 'twilio') return verifyTwilioWebhook(requestUrl, body, signature, secret)
  if (provider === 'shopify' || provider === 'woocommerce') return verifyHmac(raw, signature, secret, 'base64')
  return verifyHmac(raw, signature, secret)
}

function accepted(provider: string, payload: Record<string, any>, duplicate: boolean): Response {
  if (provider === 'twilio' && !payload.MessageStatus) {
    return response.xml(twilioComplianceXml(String(payload.Body || '')), 200, {
      'Cache-Control': 'no-store',
    })
  }

  return response.json({ accepted: true, duplicate }, 202)
}

export default new Action({
  name: 'Ingest Webhook',
  description: 'Verifies, deduplicates, stores, and queues provider events',
  method: 'POST',
  async handle(request: RequestInstance) {
    const provider = String(request.getParam('provider') || '').toLowerCase()
    const endpointKey = String(request.getParam('endpoint') || '')
    if (!SUPPORTED_PROVIDERS.has(provider) || !endpointKey)
      return response.json({ error: 'Webhook endpoint not found' }, 404)

    const endpoint = await WebhookEndpoint.where('uuid', endpointKey).where('provider', provider).first()
    if (!endpoint || endpoint.status !== 'active' || endpoint.direction !== 'inbound')
      return response.json({ error: 'Webhook endpoint not found' }, 404)

    let raw = ''
    let payload: Record<string, any>
    try {
      raw = await (request as any).clone().text()
      payload = parsedBody(raw, request.headers.get('content-type') || '')
    }
    catch {
      return response.json({ error: 'Invalid webhook payload' }, 400)
    }

    if (!signatureIsValid(provider, request.url, raw, payload, request.headers, String(endpoint.encryptedSecret || '')))
      return response.json({ error: 'Invalid webhook signature' }, 401)

    const providerEventId = eventId(provider, request.headers, payload)
    if (!providerEventId) return response.json({ error: 'Provider event id is required' }, 422)

    const existing = await WebhookEvent.where('provider', provider).where('providerEventId', providerEventId).first()
    if (existing) return accepted(provider, payload, true)

    const stored = await WebhookEvent.forceCreate({
      team_id: Number(endpoint.team_id),
      webhook_endpoint_id: endpoint.id,
      provider,
      providerEventId,
      type: eventType(provider, request.headers, payload),
      status: 'received',
      payload: JSON.stringify(payload),
      signatureVerified: true,
      attempts: 0,
    })

    await job('ProcessWebhookEvent', { eventId: stored.id, teamId: Number(endpoint.team_id) })
      .onQueue('integrations')
      .dispatch()

    return accepted(provider, payload, false)
  },
})
