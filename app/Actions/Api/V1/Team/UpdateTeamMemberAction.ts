import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { db } from '@stacksjs/database'
import { memberChangeRefusal, runFrameworkTeamAction, teamCaller } from '../../../../Support/teamAccess'

/**
 * Change a member's role or suspend them, in the caller's own workspace.
 *
 * The framework action refuses to touch the owner. This adds that nobody
 * edits their own membership and that only the owner makes or changes an
 * admin.
 */
export default new Action({
  name: 'Update Team Member',
  description: 'Changes a workspace member role or status',
  method: 'PATCH',

  async handle(request: RequestInstance) {
    const caller = await teamCaller(request)
    if (caller instanceof Response) return caller

    const memberId = Number(request.getParam('memberId'))
    const target = Number.isSafeInteger(memberId) && memberId > 0
      ? await db.selectFrom('team_members' as any).select(['user_id', 'role'] as any)
        .where('id' as any, '=', memberId).where('team_id' as any, '=', caller.teamId)
        .executeTakeFirst() as { user_id: number, role: string } | undefined
      : undefined
    if (!target) return response.json({ error: 'Team member not found' }, 404)

    const refusal = memberChangeRefusal({ actorRole: caller.role, actorUserId: caller.userId, targetUserId: Number(target.user_id), targetRole: target.role, nextRole: request.get('role') ?? undefined })
    if (refusal) return response.json({ error: refusal }, 403)

    return runFrameworkTeamAction('TeamMemberUpdateAction', request)
  },
})
