import { db } from '@stacksjs/database'
import { authenticatedUser } from '@stacksjs/auth'
import { HttpError } from '@stacksjs/error-handling'
import { Middleware } from '@stacksjs/router'

/**
 * Team Middleware
 *
 * Overrides the framework default, which decides membership from
 * `user.current_team_id ?? user.team_id`. This application keeps membership in
 * `team_members` and has neither column on `users`, so the default rejected
 * every request to a team-scoped route regardless of who was signed in.
 *
 * Parameterized use (`middleware('team:owner')`) reads the role from the
 * membership row for the same reason: `user.team_role` is never populated here.
 */
export default new Middleware({
  name: 'team',
  priority: 3,

  async handle(request) {
    const user = await authenticatedUser(request)

    if (!user)
      throw new HttpError(401, 'Unauthenticated.')

    const userId = Number((user as any).id)
    const selected = Number((user as any).current_team_id ?? (user as any).team_id)

    const query = db
      .selectFrom('team_members' as any)
      .select(['team_id', 'role'] as any)
      .where('user_id' as any, '=', userId)
      .where('status' as any, '=', 'active')

    const membership = (Number.isInteger(selected) && selected > 0
      ? await query.where('team_id' as any, '=', selected).executeTakeFirst()
      : await query.orderBy('id' as any, 'asc').executeTakeFirst()) as { team_id: number, role: string } | undefined

    if (!membership)
      throw new HttpError(403, 'You must belong to a team to access this resource.')

    const requiredRole = (request as any)._middlewareParams?.team
    if (requiredRole && String(membership.role) !== String(requiredRole))
      throw new HttpError(403, `This action requires the '${requiredRole}' team role.`)
  },
})
