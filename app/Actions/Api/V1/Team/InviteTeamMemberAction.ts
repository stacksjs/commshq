import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { inviteRefusal, runFrameworkTeamAction, teamCaller } from '../../../../Support/teamAccess'

/**
 * Invite someone to the caller's own workspace.
 *
 * The framework action creates the single-use invitation and mails it. This
 * adds what it does not check: that the team in the path is the caller's,
 * and that the caller's role allows inviting at the requested role.
 */
export default new Action({
  name: 'Invite Team Member',
  description: 'Invites a person to the caller workspace by email',
  method: 'POST',

  async handle(request: RequestInstance) {
    const caller = await teamCaller(request)
    if (caller instanceof Response) return caller
    const refusal = inviteRefusal(caller.role, request.get('role'))
    if (refusal) return response.json({ error: refusal }, 403)

    return runFrameworkTeamAction('TeamInviteAction', request)
  },
})
