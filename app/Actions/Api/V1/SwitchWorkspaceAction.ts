import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { buildActiveTeamCookie } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { memberWorkspaces, requestedWorkspaceId, secureCookies } from '../../../Support/workspaceSwitch'

/**
 * Open another of the caller's workspaces.
 *
 * Sets the framework's `active_team` cookie, which every workspace read then
 * follows: the app's own actions through `activeTeam()` and the generated
 * model routes through the framework's ownership layer. Only a workspace the
 * caller is an active member of can be chosen; anything else is a 404, so the
 * answer never says whether a workspace with that id exists.
 */
export default new Action({
  name: 'Switch Workspace',
  description: 'Makes another of the caller\'s workspaces the active one',
  method: 'POST',

  async handle(request: RequestInstance) {
    const user = await request.user()
    if (!user) return response.json({ error: 'Unauthenticated' }, 401)

    const id = requestedWorkspaceId(request.get('workspace_id'))
    if (!id) return response.json({ error: 'workspace_id must be a workspace id' }, 422)

    const workspace = (await memberWorkspaces(Number(user.id))).find(item => item.id === id)
    if (!workspace) return response.json({ error: 'Workspace not found' }, 404)

    return response.json(
      { data: { activeId: workspace.id, name: workspace.name } },
      { headers: { 'Set-Cookie': buildActiveTeamCookie(workspace.id, { secure: secureCookies() }) } },
    )
  },
})
