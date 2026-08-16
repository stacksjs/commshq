import { Campaign } from '@stacksjs/orm'
import { Job } from '@stacksjs/queue'

export default new Job({
  name: 'DispatchDueCampaigns', description: 'Queues due scheduled campaigns', queue: 'scheduler', tries: 3, backoff: [15, 60],
  async handle() {
    const due = await Campaign.where('status', 'scheduled').where('scheduledAt', '<=', new Date().toISOString()).limit(100).get()
    for (const campaign of due)
      await DispatchCampaign.dispatch({ campaignId: campaign.id, teamId: Number(campaign.team_id) })
    return { queued: due.length }
  },
})
