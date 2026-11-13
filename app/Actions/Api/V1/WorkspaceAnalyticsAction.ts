import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { activeTeamId } from '../../../Support/activeTeam'
import { analyticsPeriod, workspaceAnalytics } from '../../../Support/workspaceAnalytics'

/**
 * What the caller's workspace did over the last 7, 30 or 90 days.
 *
 * Counts only, so every member may read it. A `days` that is not one of the
 * offered periods falls back to the default rather than answering for an
 * arbitrary range.
 */
export default new Action({
  name: 'Workspace Analytics',
  description: 'Returns counts of contacts, signups, consent and sending for the active workspace over a period',
  method: 'GET',

  async handle(request: RequestInstance) {
    const teamId = await activeTeamId(request)
    if (!teamId) return response.json({ error: 'Active team required' }, 403)

    return response.json({ data: await workspaceAnalytics(teamId, analyticsPeriod(request.get('days'))) })
  },
})
