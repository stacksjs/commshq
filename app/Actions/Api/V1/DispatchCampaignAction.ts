import type { RequestInstance } from '@stacksjs/types'
import { createHash } from 'node:crypto'
import { Action } from '@stacksjs/actions'
import { Campaign } from '@stacksjs/orm'
import { job } from '@stacksjs/queue'
import { response } from '@stacksjs/router'
import CampaignRecipient from '../../../Models/CampaignRecipient'
import Contact from '../../../Models/Contact'
import { activeTeamId } from './team'

export default new Action({
  name: 'Dispatch Campaign',
  description: 'Snapshots the active audience and queues an idempotent campaign delivery',
  method: 'POST',
  async handle(request: RequestInstance) {
    const teamId = await activeTeamId(request)
    if (!teamId) return response.json({ error: 'Active team required' }, 403)

    const campaignId = Number(request.getParam('id'))
    const campaign = await Campaign.where('id', campaignId).where('team_id', teamId).first()
    if (!campaign) return response.json({ error: 'Campaign not found' }, 404)
    if (!['draft', 'scheduled', 'paused'].includes(String(campaign.status)))
      return response.json({ error: `Campaign cannot dispatch from ${campaign.status}` }, 409)

    const contacts = await Contact.where('team_id', teamId).where('status', 'active').get()
    let queued = 0
    for (const contact of contacts) {
      const address = campaign.type === 'sms' ? contact.phone : contact.email
      if (!address) continue
      const existing = await CampaignRecipient.where('campaign_id', campaignId).where('contact_id', contact.id).first()
      if (existing) continue
      await CampaignRecipient.forceCreate({
        team_id: teamId,
        campaign_id: campaignId,
        contact_id: contact.id,
        channel: campaign.type === 'sms' ? 'sms' : 'email',
        addressHash: createHash('sha256').update(String(address).trim().toLowerCase()).digest('hex'),
        status: 'queued',
        idempotencyKey: `campaign:${teamId}:${campaignId}:${contact.uuid || contact.id}`,
        snapshot: JSON.stringify({ address, firstName: contact.firstName, lastName: contact.lastName, properties: contact.properties }),
        scheduledAt: campaign.scheduledAt || new Date().toISOString(),
      })
      queued++
    }

    await campaign.update({ status: campaign.scheduledAt ? 'scheduled' : 'sending' })
    await job('DispatchCampaign', { campaignId, teamId }).onQueue('campaigns').dispatch()

    return response.json({ queued, campaignId, status: campaign.scheduledAt ? 'scheduled' : 'sending' }, 202)
  },
})
