import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Campaign } from '@stacksjs/orm'
import { response } from '@stacksjs/router'
import AutomationStepRun from '../../../Models/AutomationStepRun'
import Contact from '../../../Models/Contact'
import Earning from '../../../Models/Earning'
import Publication from '../../../Models/Publication'
import UsageMeter from '../../../Models/UsageMeter'
import { activeTeamId } from './team'

export default new Action({
  name: 'Workspace Summary',
  description: 'Returns active-team product metrics for the command center',
  method: 'GET',
  async handle(request: RequestInstance) {
    const teamId = await activeTeamId(request)
    if (!teamId) return response.json({ error: 'Active team required' }, 403)

    const [contacts, campaigns, publications, activeRuns, recentEarnings, usage] = await Promise.all([
      Contact.where('team_id', teamId).where('status', 'active').count(),
      Campaign.where('team_id', teamId).count(),
      Publication.where('team_id', teamId).where('status', 'active').count(),
      AutomationStepRun.where('team_id', teamId).where('status', 'running').count(),
      Earning.where('team_id', teamId).orderByDesc('occurredAt').limit(20).get(),
      UsageMeter.where('team_id', teamId).orderByDesc('periodStart').get(),
    ])

    return response.json({
      data: {
        contacts,
        campaigns,
        publications,
        activeRuns,
        attributedRevenue: recentEarnings.reduce((sum: number, item: { netAmount?: unknown }) => sum + Number(item.netAmount || 0), 0),
        usage,
      },
    })
  },
})
