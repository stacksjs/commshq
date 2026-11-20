import type { TeamAuthRequest } from '@stacksjs/auth'
import type { RequestInstance } from '@stacksjs/types'
import { resolveAuthenticatedMembership } from '@stacksjs/auth'

export interface ActiveTeam {
  teamId: number
  /** The member's role in that team: owner, admin, member, or viewer. */
  role: string
}

/**
 * The request as the framework's team resolver reads it: the bearer token and
 * the cookies, taken from the raw headers.
 *
 * The same shape `@stacksjs/orm`'s ownership layer builds before it scopes an
 * auto-generated `/api/v1/<model>` route, so both sides read the same token
 * and the same `active_team` cookie from the same place.
 */
export function teamRequest(request: { headers?: { get?: (name: string) => string | null } }): TeamAuthRequest {
  const header = request?.headers?.get?.('authorization') ?? ''
  const token = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : null
  const cookieHeader = request?.headers?.get?.('cookie') ?? ''
  return {
    bearerToken: () => token,
    cookies: {
      get: (name: string) => {
        for (const part of cookieHeader.split(';')) {
          const eq = part.indexOf('=')
          if (eq !== -1 && part.slice(0, eq).trim() === name) {
            try {
              return decodeURIComponent(part.slice(eq + 1).trim())
            }
            catch {
              return null
            }
          }
        }
        return null
      },
    },
  }
}

/**
 * Resolve which workspace the request is acting on, and with what role.
 *
 * This is the framework's own answer (`resolveAuthenticatedMembership`): the
 * workspace the `active_team` cookie names when the person is an active member
 * of it, otherwise the one they own, then one they administer, then any. The
 * auto-generated model routes scope by exactly this, so a page that reads both
 * an app action and a model route always sees one workspace.
 *
 * It used to be the earliest membership instead, while the model routes used
 * the framework's rule. For someone in two workspaces the two could differ,
 * and one page could show figures from one workspace beside rows from another.
 * The workspace switcher sets the cookie; see `SwitchWorkspaceAction`.
 */
export async function activeTeam(request: RequestInstance): Promise<ActiveTeam | null> {
  const membership = await resolveAuthenticatedMembership(teamRequest(request as any))
  if (!membership)
    return null
  const teamId = Number(membership.teamId)
  return Number.isInteger(teamId) && teamId > 0 ? { teamId, role: String(membership.role) } : null
}

export async function activeTeamId(request: RequestInstance): Promise<number | null> {
  return (await activeTeam(request))?.teamId ?? null
}
