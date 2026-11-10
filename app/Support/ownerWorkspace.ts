import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'

/**
 * Which workspace the demo seeders fill, and whether they may run at all.
 *
 * Two seeders need both answers and had their own copy of each. "Which
 * workspace is the demo workspace" is exactly the kind of fact that drifts
 * when it is written down twice: rename the team in `OwnerSeeder` and one
 * seeder silently claims nothing while the other still works, which looks
 * like a bug in whichever page reads the half that broke.
 */

/** The workspace `OwnerSeeder` creates, matched by the name it uses. */
export const OWNER_WORKSPACE = 'CommsHQ'

const PRODUCTION_ENVS = new Set(['production', 'prod'])

/** The environment name, lowercased, or an empty string when it is unset. */
export function appEnvName(): string {
  return String(env.APP_ENV || '').toLowerCase()
}

/**
 * Whether this is the one environment that does not get invented data.
 *
 * Elsewhere a fabricated workspace is the point. In production it would put
 * invented rows into a real account, where they are one campaign away from
 * being sent to, and a bounce rate built out of seed data is still a
 * reputation.
 */
export function isProductionEnv(): boolean {
  return PRODUCTION_ENVS.has(appEnvName())
}

/**
 * The id of the owner workspace, or null when it does not exist.
 *
 * Null is the normal answer rather than an error: `OwnerSeeder` bails out
 * deliberately when `COMMSHQ_OWNER_PASSWORD` is unset outside a local
 * `APP_ENV`, and inventing a team to hold these rows would create a workspace
 * no account is a member of.
 */
export async function ownerWorkspaceId(): Promise<number | null> {
  const team = await db.selectFrom('teams' as any)
    .select(['id'] as any)
    .where('name' as any, '=', OWNER_WORKSPACE)
    .executeTakeFirst() as { id: number } | undefined

  if (!team)
    return null

  const id = Number(team.id)
  return Number.isInteger(id) && id > 0 ? id : null
}
