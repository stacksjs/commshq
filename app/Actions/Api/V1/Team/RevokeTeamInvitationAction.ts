import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { canManageTeam, runFrameworkTeamAction, teamCaller } from '../../../../Support/teamAccess'

/**
 * Revoke a pending invitation in the caller's own workspace.
 */
export default new Action({
  name: 'Revoke Team Invitation',
  description: 'Revokes a pending workspace invitation',
  method: 'DELETE',

  async handle(request: RequestInstance) {
    const caller = await teamCaller(request)
    if (caller instanceof Response) return caller
    if (!canManageTeam(caller.role)) return response.json({ error: 'Managing invitations requires an admin or owner role' }, 403)

    return runFrameworkTeamAction('TeamInvitationDestroyAction', request)
  },
})
