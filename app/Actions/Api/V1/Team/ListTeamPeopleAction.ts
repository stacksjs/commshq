import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { db } from '@stacksjs/database'
import { invitationStatus } from '../../../../../storage/framework/defaults/app/Actions/Dashboard/Teams/team-records'
import { activeTeam } from '../../../../Support/activeTeam'
import { canManageTeam, isOwner } from '../../../../Support/teamAccess'

/**
 * The caller's workspace: its members, its pending invitations, and what
 * the caller may do about them.
 *
 * Every member may read this; who else is in the workspace is not an
 * admin-only fact. The `me` block is what the page builds its controls
 * from, and it is advice only: each write route checks the role again.
 *
 * Invitations are listed only for someone who can manage them. A pending
 * invitation is an email address of a person who has not joined, and a
 * viewer has no use for it.
 */
export default new Action({
  name: 'List Team People',
  description: 'Lists the active workspace members and pending invitations',
  method: 'GET',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const user = await request.user()
    const userId = Number(user?.id)
    if (!membership || !Number.isInteger(userId) || userId < 1) return response.json({ error: 'Active team required' }, 403)

    const teamId = membership.teamId
    const manages = canManageTeam(membership.role)

    const [team, members, invitations] = await Promise.all([
      db.selectFrom('teams' as any).select(['id', 'name'] as any).where('id' as any, '=', teamId).executeTakeFirst() as Promise<{ id: number, name: string } | undefined>,
      db.selectFrom('team_members' as any)
        .innerJoin('users' as any, 'users.id' as any, '=' as any, 'team_members.user_id' as any)
        .select(['team_members.id as id', 'team_members.user_id as user_id', 'team_members.role as role', 'team_members.status as status', 'team_members.created_at as created_at', 'users.name as name', 'users.email as email'] as any)
        .where('team_members.team_id' as any, '=', teamId)
        .orderBy('users.name' as any, 'asc')
        .execute() as Promise<any[]>,
      manages
        ? db.selectFrom('team_invitations' as any)
            .select(['id', 'email', 'role', 'status', 'delivery_status', 'expires_at', 'created_at'] as any)
            .where('team_id' as any, '=', teamId)
            .where('status' as any, '=', 'pending')
            .orderBy('created_at' as any, 'desc')
            .execute() as Promise<any[]>
        : Promise.resolve([] as any[]),
    ])

    return response.json({
      team: { id: teamId, name: String(team?.name || '') },
      me: { userId, role: membership.role, canManage: manages, isOwner: isOwner(membership.role) },
      members: members.map(member => ({
        id: Number(member.id),
        userId: Number(member.user_id),
        name: String(member.name || member.email || 'Team member'),
        email: String(member.email || ''),
        role: String(member.role || 'member'),
        status: String(member.status || 'active'),
        joinedAt: member.created_at ? String(member.created_at) : null,
      })),
      invitations: invitations.map(invitation => ({
        id: Number(invitation.id),
        email: String(invitation.email),
        role: String(invitation.role || 'member'),
        status: invitationStatus(invitation.status, invitation.expires_at),
        deliveryStatus: String(invitation.delivery_status || 'pending'),
        expiresAt: String(invitation.expires_at),
      })),
    })
  },
})
