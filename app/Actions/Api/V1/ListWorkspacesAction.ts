import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { activeTeam } from '../../../Support/activeTeam'
import { memberWorkspaces } from '../../../Support/workspaceSwitch'

/**
 * The workspaces the caller can switch between, and which one is open.
 *
 * Behind the `team` middleware, so a brand-new account has its own workspace
 * by the time this runs.
 */
export default new Action({
  name: 'List Workspaces',
  description: 'Returns the caller\'s workspaces and the active one',
  method: 'GET',

  async handle(request: RequestInstance) {
    const user = await request.user()
    const membership = await activeTeam(request)
    if (!user || !membership) return response.json({ error: 'Active team required' }, 403)

    const workspaces = await memberWorkspaces(Number(user.id))
    return response.json({
      data: {
        activeId: membership.teamId,
        workspaces: workspaces.map(workspace => ({ ...workspace, active: workspace.id === membership.teamId })),
      },
    })
  },
})
