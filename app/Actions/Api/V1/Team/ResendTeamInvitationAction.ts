import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { canManageTeam, runFrameworkTeamAction, teamCaller } from '../../../../Support/teamAccess'

/**
 * Send a pending invitation again, for the caller's own workspace. The
 * framework action scopes the invitation to the team in the path, which
 * `teamCaller` has already held to the caller's team.
 */
export default new Action({
  name: 'Resend Team Invitation',
  description: 'Sends a pending workspace invitation again',
  method: 'POST',

  async handle(request: RequestInstance) {
    const caller = await teamCaller(request)
    if (caller instanceof Response) return caller
    if (!canManageTeam(caller.role)) return response.json({ error: 'Managing invitations requires an admin or owner role' }, 403)

    return runFrameworkTeamAction('TeamInvitationResendAction', request)
  },
})
