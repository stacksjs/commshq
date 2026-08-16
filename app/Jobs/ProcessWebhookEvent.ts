import { log } from '@stacksjs/logging'
import { classifySmsIntent } from '@stacksjs/sms'
import { Job } from '@stacksjs/queue'
import CommerceConnection from '../Models/CommerceConnection'
import CommerceEvent from '../Models/CommerceEvent'
import WebhookEvent from '../Models/WebhookEvent'

interface ProcessWebhookPayload {
  eventId: number
  teamId: number
}

function objectPayload(value: unknown): Record<string, any> {
  if (typeof value === 'string') return JSON.parse(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Stored webhook payload is invalid')
  return value as Record<string, any>
}

function destination(payload: Record<string, any>): string {
  return String(payload.From || payload.from || payload.recipient || payload.email || '').trim().toLowerCase()
}

export default new Job({
  name: 'ProcessWebhookEvent',
  description: 'Normalizes verified provider events and applies compliance state',
  queue: 'integrations',
  tries: 5,
  backoff: [15, 60, 300, 900],

  async handle(input: ProcessWebhookPayload) {
    const event = await WebhookEvent.where('id', input.eventId).where('team_id', input.teamId).first()
    if (!event || event.status === 'processed') return { skipped: true }

    await WebhookEvent.forceUpdate(event.id, { status: 'processing', attempts: Number(event.attempts || 0) + 1, error: null })

    try {
      const payload = objectPayload(event.payload)
      const recipient = destination(payload)

      if (event.provider === 'twilio' && !payload.MessageStatus) {
        const { intent, keyword } = classifySmsIntent(String(payload.Body || ''))
        if (intent === 'opt-out') {
          const existing = await CommunicationSuppression.where('team_id', input.teamId).where('channel', 'sms').where('recipient', recipient).first()
          if (!existing) await CommunicationSuppression.create({ team_id: input.teamId, channel: 'sms', recipient, reason: 'unsubscribe', source: `twilio:${keyword}`, suppressedAt: new Date().toISOString() })
          await ConsentEvent.create({ team_id: input.teamId, recipient, channel: 'sms', action: 'revoked', purpose: 'marketing', source: 'twilio_inbound', policyVersion: '1.0', proof: JSON.stringify({ eventId: event.providerEventId, keyword }), occurredAt: new Date().toISOString() })
        }
        else if (intent === 'opt-in') {
          const existing = await CommunicationSuppression.where('team_id', input.teamId).where('channel', 'sms').where('recipient', recipient).first()
          if (existing && !existing.liftedAt) await CommunicationSuppression.forceUpdate(existing.id, { liftedAt: new Date().toISOString() })
          await ConsentEvent.create({ team_id: input.teamId, recipient, channel: 'sms', action: 'granted', purpose: 'marketing', source: 'twilio_inbound', policyVersion: '1.0', proof: JSON.stringify({ eventId: event.providerEventId, keyword }), occurredAt: new Date().toISOString() })
        }
      }

      if (event.provider === 'mail' && ['bounce', 'complaint'].some(kind => String(event.type).includes(kind))) {
        const existing = await CommunicationSuppression.where('team_id', input.teamId).where('channel', 'email').where('recipient', recipient).first()
        if (!existing) await CommunicationSuppression.create({ team_id: input.teamId, channel: 'email', recipient, reason: String(event.type).includes('complaint') ? 'complaint' : 'bounce', source: 'owned_mail', suppressedAt: new Date().toISOString() })
      }

      if (['shopify', 'woocommerce'].includes(String(event.provider))) {
        const connection = await CommerceConnection.where('team_id', input.teamId).where('provider', event.provider).where('status', 'active').first()
        if (!connection) throw new Error(`No active ${event.provider} connection for team ${input.teamId}`)
        const existing = await CommerceEvent.where('commerce_connection_id', connection.id).where('externalId', event.providerEventId).first()
        if (!existing) {
          await CommerceEvent.forceCreate({
            team_id: input.teamId,
            commerce_connection_id: connection.id,
            externalId: event.providerEventId,
            type: String(event.type).includes('refund') ? 'order_refunded' : String(event.type).includes('fulfill') ? 'order_fulfilled' : 'order_created',
            amount: Number(payload.total_price || payload.total || 0) * 100,
            currency: String(payload.currency || 'USD').toUpperCase(),
            payload: JSON.stringify(payload),
            occurredAt: String(payload.created_at || new Date().toISOString()),
          })
        }
      }

      await WebhookEvent.forceUpdate(event.id, { status: 'processed', processedAt: new Date().toISOString(), error: null })
      return { processed: true }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await WebhookEvent.forceUpdate(event.id, { status: Number(event.attempts || 0) + 1 >= 5 ? 'dead_lettered' : 'failed', error: message })
      log.error(`[webhook] event ${event.id} failed: ${message}`)
      throw error
    }
  },
})
