import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { activeTeamId } from '../../../Support/activeTeam'
import { workspaceSetup } from '../../../Support/workspaceSetup'

/**
 * Which setup steps the caller's workspace has done.
 *
 * Yes or no per step and nothing else. Every member may read it: it reveals
 * that the workspace has a contact or a verified domain, not which.
 */
export default new Action({
  name: 'Workspace Setup',
  description: 'Returns which setup steps the active workspace has completed',
  method: 'GET',

  async handle(request: RequestInstance) {
    const teamId = await activeTeamId(request)
    if (!teamId) return response.json({ error: 'Active team required' }, 403)

    return response.json({ data: { steps: await workspaceSetup(teamId) } })
  },
})
