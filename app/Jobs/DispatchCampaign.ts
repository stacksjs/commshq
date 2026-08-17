import { config } from '@stacksjs/config'
import { mail } from '@stacksjs/email'
import { log } from '@stacksjs/logging'
import { assertUsageAvailable, deliveryIdempotencyKey } from '@stacksjs/newsletter'
import { Campaign, CampaignSend } from '@stacksjs/orm'
import { Job } from '@stacksjs/queue'
import { estimateSmsSegments, isWithinSmsQuietHours, sendSms } from '@stacksjs/sms'
import CampaignRecipient from '../Models/CampaignRecipient'
import UsageMeter from '../Models/UsageMeter'

interface DispatchCampaignPayload {
  campaignId: number
  teamId: number
}

function parseSnapshot(value: unknown): Record<string, any> {
  return typeof value === 'string' ? JSON.parse(value) : value as Record<string, any>
}

async function consentAllows(teamId: number, channel: 'email' | 'sms', recipient: string): Promise<boolean> {
  const suppression = await CommunicationSuppression.where('team_id', teamId).where('channel', channel).where('recipient', recipient).first()
  if (suppression && !suppression.liftedAt) return false
  const consent = await ConsentEvent.where('team_id', teamId).where('channel', channel).where('recipient', recipient).orderByDesc('occurredAt').first()
  return !!consent && ['granted', 'confirmed'].includes(String(consent.action))
}

async function assertCampaignQuota(teamId: number, channel: 'email' | 'sms', requested: number): Promise<void> {
  const meterKey = channel === 'sms' ? 'sms_segments' : 'emails'
  const meter = await UsageMeter.where('team_id', teamId).where('key', meterKey).orderByDesc('periodStart').first()
  const limit = !meter ? 0 : meter.includedQuantity == null ? null : Number(meter.includedQuantity)
  assertUsageAvailable([{ meter: meterKey, used: Number(meter?.quantity || 0), limit, requested }])
}

export default new Job({
  name: 'DispatchCampaign',
  description: 'Delivers a team-scoped email or SMS campaign from an immutable recipient snapshot',
  queue: 'campaigns',
  tries: 5,
  backoff: [30, 120, 600, 1800],

  async handle(payload: DispatchCampaignPayload) {
    const campaign = await Campaign.where('id', payload.campaignId).where('team_id', payload.teamId).first()
    if (!campaign) throw new Error('Campaign not found in active team')
    if (['cancelled', 'sent'].includes(String(campaign.status))) return { skipped: true }
    if (campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now())
      throw new Error('Campaign is not due yet')

    const channel: 'email' | 'sms' = campaign.type === 'sms' ? 'sms' : 'email'
    const pending = await CampaignRecipient.where('team_id', payload.teamId).where('campaign_id', payload.campaignId).where('status', 'queued').limit(100).get()
    await assertCampaignQuota(payload.teamId, channel, pending.length)
    await campaign.update({ status: 'sending' })

    let sent = 0
    let suppressed = 0
    let failed = 0

    for (const recipientRow of pending) {
      const current = await Campaign.where('id', payload.campaignId).where('team_id', payload.teamId).first()
      if (!current || ['paused', 'cancelled'].includes(String(current.status))) break

      const snapshot = parseSnapshot(recipientRow.snapshot)
      const recipient = String(snapshot.address || '').trim().toLowerCase()
      if (!recipient || !await consentAllows(payload.teamId, channel, recipient)) {
        await CampaignRecipient.forceUpdate(recipientRow.id, { status: 'suppressed' })
        suppressed++
        continue
      }

      const idempotencyKey = deliveryIdempotencyKey({ teamId: payload.teamId, campaignId: payload.campaignId, channel, recipient })
      const delivery = await CampaignSend.where('idempotencyKey', idempotencyKey).first()
        ?? await CampaignSend.create({ team_id: payload.teamId, campaignId: payload.campaignId, channel, recipient, idempotencyKey, status: 'sending' })
      if (delivery && ['sent', 'delivered'].includes(String(delivery.status))) continue

      try {
        if (channel === 'sms') {
          const timezone = String(snapshot.timezone || campaign.timezone || 'UTC')
          if (isWithinSmsQuietHours(new Date(), { startHour: Number(config.sms.quietHours?.startHour ?? 20), endHour: Number(config.sms.quietHours?.endHour ?? 8), timezone })) {
            await delivery.update({ status: 'deferred' })
            continue
          }
          const body = String(campaign.text || '')
          const segments = estimateSmsSegments(body).segments
          const result = await sendSms({ to: recipient, body, statusCallback: config.sms.drivers?.twilio?.statusCallback })
          if (!result.success) throw new Error(result.error || 'SMS provider rejected the message')
          await delivery.update({ status: 'sent', providerMessageId: result.messageId, segments, cost: result.price || 0, sentAt: new Date().toISOString() })
        }
        else {
          const from = String(campaign.fromAddress || config.email.from?.address || '')
          const domain = from.split('@')[1]
          const senderDomain = domain ? await SenderDomain.where('team_id', payload.teamId).where('domain', domain).where('status', 'verified').first() : null
          if (!senderDomain) throw new Error('A verified sender domain is required')
          const result = await mail.send({
            to: [recipient],
            from: { name: String(campaign.fromName || config.email.from?.name || 'CommsHQ'), address: from },
            replyTo: campaign.replyTo || undefined,
            subject: String(campaign.subject || ''),
            html: String(campaign.template || campaign.text || ''),
            text: String(campaign.text || ''),
          } as any)
          if (result?.success === false) throw new Error(result.message || 'Mail server rejected the message')
          await delivery.update({ status: 'sent', providerMessageId: result?.messageId, sentAt: new Date().toISOString() })
        }
        await CampaignRecipient.forceUpdate(recipientRow.id, { status: 'sent' })
        sent++
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await delivery.update({ status: 'failed', error: message, failedAt: new Date().toISOString() })
        await CampaignRecipient.forceUpdate(recipientRow.id, { status: 'failed' })
        failed++
        log.error(`[campaign] delivery ${delivery.id} failed: ${message}`)
      }
    }

    const remaining = await CampaignRecipient.where('team_id', payload.teamId).where('campaign_id', payload.campaignId).where('status', 'queued').count()
    if (remaining > 0) await DispatchCampaign.dispatch({ campaignId: payload.campaignId, teamId: payload.teamId })
    else await campaign.update({ status: failed > 0 && sent === 0 ? 'failed' : 'sent', sentAt: new Date().toISOString() })

    return { sent, suppressed, failed, remaining }
  },
})
