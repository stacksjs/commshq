import type { RequestInstance } from '@stacksjs/types'
import { createHash } from 'node:crypto'
import { Action } from '@stacksjs/actions'
import { Campaign } from '@stacksjs/orm'
import { job } from '@stacksjs/queue'
import { response } from '@stacksjs/router'
import AudienceMembership from '../../../Models/AudienceMembership'
import CampaignRecipient from '../../../Models/CampaignRecipient'
import Contact from '../../../Models/Contact'
import { activeTeamId } from './team'

/**
 * The audience a campaign is for, from `segmentDefinition.audienceId`. A
 * newsletter goes to the people who signed up for it, not to every contact
 * the workspace has ever collected; without an audience the campaign keeps
 * the old behaviour of every active contact.
 */
function campaignAudienceId(segmentDefinition: unknown): number | undefined {
  try {
    const doc = typeof segmentDefinition === 'string' ? JSON.parse(segmentDefinition) : segmentDefinition
    const id = Number((doc as any)?.audienceId)
    return Number.isInteger(id) && id > 0 ? id : undefined
  }
  catch {
    return undefined
  }
}

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

    const audienceId = campaignAudienceId(campaign.segmentDefinition)
    let contacts = await Contact.where('team_id', teamId).where('status', 'active').get()
    if (audienceId) {
      const members = await AudienceMembership.where('team_id', teamId).where('audience_id', audienceId).where('status', 'active').get()
      const memberIds = new Set(members.map((member: any) => Number(member.contact_id)))
      contacts = contacts.filter((contact: any) => memberIds.has(Number(contact.id)))
    }
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
