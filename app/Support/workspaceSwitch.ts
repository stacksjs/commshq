import { config } from '@stacksjs/config'
import { db } from '@stacksjs/database'

/**
 * The workspaces a person can switch between, and the cookie that remembers
 * the choice.
 *
 * The choice is the framework's `active_team` cookie, the one its own team
 * resolver reads (`resolveAuthenticatedMembership`). It only ever selects
 * among the person's own active memberships: a cookie naming a workspace they
 * do not belong to, or have been suspended from, is ignored and the resolver
 * falls back to the workspace they own.
 */

export interface WorkspaceChoice {
  id: number
  name: string
  role: string
}

/** Every workspace the person is an active member of, by name. */
export async function memberWorkspaces(userId: number): Promise<WorkspaceChoice[]> {
  const memberships = await db.selectFrom('team_members' as any)
    .select(['team_id', 'role'] as any)
    .where('user_id' as any, '=', userId)
    .where('status' as any, '=', 'active')
    .execute() as unknown as Array<{ team_id: number, role: string }>
  const roleByTeam = new Map(memberships.map(row => [Number(row.team_id), String(row.role || '')]))
  if (roleByTeam.size === 0)
    return []
  const teams = await db.selectFrom('teams' as any)
    .select(['id', 'name'] as any)
    .where('id' as any, 'in', [...roleByTeam.keys()])
    .execute() as unknown as Array<{ id: number, name: string }>
  return teams
    .map(team => ({ id: Number(team.id), name: String(team.name || ''), role: roleByTeam.get(Number(team.id)) ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
}

/** The workspace id a switch request names, or null when it is not a positive whole number. */
export function requestedWorkspaceId(value: unknown): number | null {
  const id = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Whether the cookie should be Secure: whenever the site is served over https. */
export function secureCookies(appUrl: unknown = config.app?.url ?? process.env.APP_URL): boolean {
  return String(appUrl ?? '').trim().toLowerCase().startsWith('https://')
}
