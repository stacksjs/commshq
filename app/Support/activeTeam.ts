import type { RequestInstance } from '@stacksjs/types'
import { db } from '@stacksjs/database'

export interface ActiveTeam {
  teamId: number
  /** The member's role in that team: owner, admin, member, or viewer. */
  role: string
}

/**
 * Resolve which team the request is acting on, and with what role.
 *
 * Membership lives in `team_members`, not on the user row. The framework
 * default reads `user.current_team_id ?? user.team_id`, and this application
 * has neither column, so that check resolved to undefined for every user and
 * every team-scoped endpoint answered 403. The same absence made
 * `user.team_role` undefined, so role checks failed closed as well.
 *
 * A denormalized column still wins when one is present, so an app that later
 * adds `current_team_id` keeps its explicit team selection.
 */
export async function activeTeam(request: RequestInstance): Promise<ActiveTeam | null> {
  const user = await request.user()
  if (!user) return null

  const userId = Number(user.id)
  if (!Number.isInteger(userId) || userId < 1) return null

  const selected = Number((user as any).current_team_id ?? (user as any).team_id)
  const query = db
    .selectFrom('team_members' as any)
    .select(['team_id', 'role'] as any)
    .where('user_id' as any, '=', userId)
    .where('status' as any, '=', 'active')

  const row = (Number.isInteger(selected) && selected > 0
    ? await query.where('team_id' as any, '=', selected).executeTakeFirst()
    // No explicit selection: fall back to the earliest membership, so the
    // answer is stable across requests rather than whatever the DB returns first.
    : await query.orderBy('id' as any, 'asc').executeTakeFirst()) as { team_id: number, role: string } | undefined

  if (!row) return null

  const teamId = Number(row.team_id)
  return Number.isInteger(teamId) && teamId > 0 ? { teamId, role: String(row.role) } : null
}

export async function activeTeamId(request: RequestInstance): Promise<number | null> {
  return (await activeTeam(request))?.teamId ?? null
}
