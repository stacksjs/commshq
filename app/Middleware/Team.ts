import { authenticatedUser } from '@stacksjs/auth'
import { HttpError } from '@stacksjs/error-handling'
import { Middleware } from '@stacksjs/router'
import { activeTeam } from '../Support/activeTeam'
import { ensureSignupWorkspace } from '../Support/signupWorkspace'

/**
 * Team Middleware
 *
 * Overrides the framework default, which decides membership from
 * `user.current_team_id ?? user.team_id`. This application keeps membership in
 * `team_members` and has neither column on `users`, so the default rejected
 * every request to a team-scoped route regardless of who was signed in.
 *
 * Which workspace is `activeTeam()`'s answer, the same one the auto-generated
 * model routes scope by: the one the workspace switcher chose, when the person
 * still belongs to it, and otherwise the one they own.
 *
 * An account that has never belonged to a workspace gets its own here, on
 * its first request: see `app/Support/signupWorkspace.ts`.
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

    let membership = await activeTeam(request as any)

    // A new account has no workspace yet: make the one sign-up promised.
    if (!membership) {
      const made = await ensureSignupWorkspace({ id: (user as any).id, name: (user as any).name, email: (user as any).email })
      if (made.teamId)
        membership = { teamId: made.teamId, role: 'owner' }
    }

    if (!membership)
      throw new HttpError(403, 'You must belong to a team to access this resource.')

    const requiredRole = (request as any)._middlewareParams?.team
    if (requiredRole && String(membership.role) !== String(requiredRole))
      throw new HttpError(403, `This action requires the '${requiredRole}' team role.`)
  },
})
