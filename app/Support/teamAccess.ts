import type { RequestInstance } from '@stacksjs/types'
import { storagePath } from '@stacksjs/path'
import { response } from '@stacksjs/router'
import { activeTeam } from './activeTeam'

/**
 * Who may change a workspace's people, and the checks the workspace's own
 * routes make before handing a request to the framework's team actions.
 *
 * The framework ships the whole invitation flow: create, deliver, resend,
 * revoke, accept, and member role and status changes. Its routes are for a
 * platform administrator, though. They take any team id in the path and are
 * guarded by a platform role, not by membership, so a workspace owner could
 * not use them and must not be let near them as they are. The routes under
 * `/v1/teams/{id}` in `routes/api.ts` put two things in front of the same
 * actions: the caller is an active member of exactly the team in the path,
 * and the caller's role in that team allows the change.
 *
 * The framework already refuses to change or remove the owner. The rules
 * added here are about admins: an admin runs the day-to-day list but cannot
 * make, change or remove another admin, and nobody edits their own
 * membership, which is how a workspace ends up with no one able to manage it.
 */

export function canManageTeam(role: unknown): boolean {
  return ['owner', 'admin'].includes(String(role || '').toLowerCase())
}

export function isOwner(role: unknown): boolean {
  return String(role || '').toLowerCase() === 'owner'
}

/** Why this actor may not invite someone at this role, or undefined when they may. */
export function inviteRefusal(actorRole: unknown, invitedRole: unknown): string | undefined {
  if (!canManageTeam(actorRole))
    return 'Inviting people requires an admin or owner role'
  if (String(invitedRole ?? 'member').trim().toLowerCase() === 'admin' && !isOwner(actorRole))
    return 'Only the workspace owner can invite an admin'
  return undefined
}

export interface MemberChange {
  actorRole: unknown
  actorUserId: number
  targetUserId: number
  targetRole: unknown
  /** The role being set, when the change sets one. */
  nextRole?: unknown
}

/** Why this actor may not change or remove this member, or undefined when they may. */
export function memberChangeRefusal(change: MemberChange): string | undefined {
  if (!canManageTeam(change.actorRole))
    return 'Changing members requires an admin or owner role'
  if (change.actorUserId === change.targetUserId)
    return 'You cannot change your own membership'
  const touchesAdmin = String(change.targetRole || '').toLowerCase() === 'admin'
    || (change.nextRole !== undefined && String(change.nextRole).trim().toLowerCase() === 'admin')
  if (touchesAdmin && !isOwner(change.actorRole))
    return 'Only the workspace owner can make, change or remove an admin'
  return undefined
}

export interface TeamCaller {
  teamId: number
  userId: number
  role: string
}

/**
 * Resolve the caller for a `/v1/teams/{id}/...` route, or the response that
 * refuses them.
 *
 * A path naming any team but the caller's own is answered 404, the same as a
 * team that does not exist: whether another workspace exists is not this
 * caller's to learn.
 */
export async function teamCaller(request: RequestInstance): Promise<TeamCaller | Response> {
  const membership = await activeTeam(request)
  const user = await request.user()
  const userId = Number(user?.id)
  if (!membership || !Number.isInteger(userId) || userId < 1)
    return response.json({ error: 'Active team required' }, 403) as unknown as Response

  if (Number(request.getParam('id')) !== membership.teamId)
    return response.json({ error: 'Team not found' }, 404) as unknown as Response

  return { teamId: membership.teamId, userId, role: membership.role }
}

export type FrameworkTeamAction = 'TeamInviteAction' | 'TeamInvitationResendAction' | 'TeamInvitationDestroyAction' | 'TeamMemberUpdateAction' | 'TeamMemberDestroyAction'

/**
 * Hand a request that has passed the checks above to the framework action
 * that does the work.
 *
 * Loaded by path at call time, not imported at the top of the file. A static
 * import would put the framework's action sources inside this application's
 * type check, where they are read-only and not this application's to fix.
 */
export async function runFrameworkTeamAction(name: FrameworkTeamAction, request: RequestInstance): Promise<unknown> {
  const module = await import(storagePath(`framework/defaults/app/Actions/Dashboard/Teams/${name}.ts`)) as { default: { handle: (request: RequestInstance) => Promise<unknown> } }
  return module.default.handle(request)
}
