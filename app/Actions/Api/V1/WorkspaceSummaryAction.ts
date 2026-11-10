import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { Campaign } from '@stacksjs/orm'
import { response } from '@stacksjs/router'
import Audience from '../../../Models/Audience'
import AutomationStepRun from '../../../Models/AutomationStepRun'
import Contact from '../../../Models/Contact'
import Earning from '../../../Models/Earning'
import MessageTemplate from '../../../Models/MessageTemplate'
import Publication from '../../../Models/Publication'
import Segment from '../../../Models/Segment'
import UsageMeter from '../../../Models/UsageMeter'
import { activeTeamId } from '../../../Support/activeTeam'

export default new Action({
  name: 'Workspace Summary',
  description: 'Returns active-team product metrics for the command center',
  method: 'GET',
  async handle(request: RequestInstance) {
    const teamId = await activeTeamId(request)
    if (!teamId) return response.json({ error: 'Active team required' }, 403)

    const [workspace, contacts, campaigns, publications, activeRuns, recentEarnings, usage, audiences, segments, templates] = await Promise.all([
      /*
       * The workspace's own name, so the page does not have to guess it. The
       * command center greeted every account as "Sunday Paper Co.", a company
       * that exists in no table: the one piece of text on the page that names
       * who you are was the one piece nobody could change.
       */
      db.selectFrom('teams' as any).select(['name'] as any).where('id' as any, '=', teamId).executeTakeFirst(),
      Contact.where('team_id', teamId).where('status', 'active').count(),
      Campaign.where('team_id', teamId).count(),
      Publication.where('team_id', teamId).where('status', 'active').count(),
      AutomationStepRun.where('team_id', teamId).where('status', 'running').count(),
      Earning.where('team_id', teamId).orderByDesc('occurredAt').limit(20).get(),
      UsageMeter.where('team_id', teamId).orderByDesc('periodStart').get(),
      /*
       * The library: what this workspace has to work with, as opposed to what
       * it has done. Counted here rather than fetched by the page from three
       * more endpoints, because three extra round trips to render three
       * numbers is three chances for the panel to be half-loaded.
       */
      Audience.where('team_id', teamId).count(),
      Segment.where('team_id', teamId).count(),
      MessageTemplate.where('team_id', teamId).count(),
    ])

    return response.json({
      data: {
        workspace: { id: teamId, name: (workspace as { name?: string } | undefined)?.name ?? null },
        contacts,
        campaigns,
        publications,
        activeRuns,
        attributedRevenue: recentEarnings.reduce((sum: number, item: { netAmount?: unknown }) => sum + Number(item.netAmount || 0), 0),
        library: { audiences, segments, templates },
        usage,
      },
    })
  },
})
