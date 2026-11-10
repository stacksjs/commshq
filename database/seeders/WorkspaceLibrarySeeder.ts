import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the seeded library an owner: audiences, segments, message templates.
 *
 * The same gap `WorkspaceContactsSeeder` closed for contacts, and for the same
 * reason. `Team` is on the seeder's ACCOUNT_MODELS list, so the model pass
 * leaves every foreign key to it null on purpose, and the framework's own
 * position is that which account owns a seeded row is the application's
 * decision. Contacts were claimed; these three tables were not, so a workspace
 * that signed in held 36 contacts and nothing else, and every page reading an
 * audience, a segment or a template was correctly empty.
 *
 * Unlike the contacts seeder this writes no timeline. These rows carry nothing
 * that has to agree across columns, so ownership is the whole change and one
 * statement per table is enough.
 */

interface ClaimTarget {
  table: string
  /**
   * The column the table's unique index pairs with `team_id`.
   *
   * All three are (team_id, name) today. Named per target rather than assumed,
   * because a table that later keys on a slug or an external id needs this to
   * be the column the collision would actually happen on, and silently
   * checking the wrong one would fail the claim at the database instead.
   */
  uniqueColumn: string
  /** What to call one of these rows in the log line. */
  noun: string
}

const TARGETS: readonly ClaimTarget[] = [
  { table: 'audiences', uniqueColumn: 'name', noun: 'audience' },
  { table: 'segments', uniqueColumn: 'name', noun: 'segment' },
  { table: 'message_templates', uniqueColumn: 'name', noun: 'message template' },
]

/**
 * How many ids go into one `in (...)`.
 *
 * SQLite's default limit is 999 bound parameters per statement, and these
 * counts are 4, 5 and 6 today. The chunking is here for the day a
 * `useSeeder.count` is raised, so that change stays a one-number edit in the
 * model rather than a seed run that fails on a limit nobody was thinking
 * about.
 */
const ID_CHUNK = 400

interface ClaimResult {
  claimed: number
  skipped: number
}

/**
 * Claim one table's orphans for the workspace.
 *
 * A row whose unique value the workspace already holds is left unclaimed and
 * counted rather than dropped or overwritten. The factories no longer collide
 * with each other, but a workspace that has been used has real rows in it, and
 * a seeded row must not be what breaks `./buddy seed` for them.
 */
async function claimOrphans(target: ClaimTarget, teamId: number): Promise<ClaimResult> {
  const orphans = await db.selectFrom(target.table as any)
    .select(['id', target.uniqueColumn] as any)
    .where('team_id' as any, 'is', null)
    .orderBy('id' as any)
    .execute() as Record<string, unknown>[]

  if (orphans.length === 0)
    return { claimed: 0, skipped: 0 }

  const owned = await db.selectFrom(target.table as any)
    .select([target.uniqueColumn] as any)
    .where('team_id' as any, '=', teamId)
    .execute() as Record<string, unknown>[]

  const taken = new Set(owned
    .map(row => String(row[target.uniqueColumn] ?? '').toLowerCase())
    .filter(Boolean))

  const claimable: number[] = []
  for (const row of orphans) {
    const value = String(row[target.uniqueColumn] ?? '').toLowerCase()
    if (value && taken.has(value))
      continue
    if (value)
      taken.add(value)
    claimable.push(Number(row.id))
  }

  const now = new Date().toISOString()
  for (let at = 0; at < claimable.length; at += ID_CHUNK) {
    const chunk = claimable.slice(at, at + ID_CHUNK)
    await db.updateTable(target.table as any)
      .set({ team_id: teamId, updated_at: now } as any)
      .where('id' as any, 'in', chunk as any)
      /*
       * `team_id is null` again, although the ids were selected on it. The
       * select and the update are separate statements, so anything else
       * holding this connection between them keeps its claim rather than
       * having it quietly reassigned here.
       */
      .where('team_id' as any, 'is', null)
      .execute()
  }

  return { claimed: claimable.length, skipped: orphans.length - claimable.length }
}

export default class WorkspaceLibrarySeeder extends Seeder {
  /** After `WorkspaceContactsSeeder` (order 10), which claims the audience itself. */
  static order = 11
  static tags = ['demo']

  async run(): Promise<void> {
    if (isProductionEnv()) {
      log.info(`[WorkspaceLibrarySeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get an invented library.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspaceLibrarySeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet, so there is nobody to own these rows.`)
      return
    }

    const summary: string[] = []
    for (const target of TARGETS) {
      const result = await claimOrphans(target, teamId)
      if (result.claimed === 0 && result.skipped === 0)
        continue
      summary.push(`${result.claimed} ${target.noun}(s)${result.skipped > 0 ? `, leaving ${result.skipped} the workspace already holds` : ''}`)
    }

    if (summary.length === 0) {
      log.info('[WorkspaceLibrarySeeder] Nothing to claim: every audience, segment and template already belongs to a workspace.')
      return
    }

    log.info(`[WorkspaceLibrarySeeder] Claimed ${summary.join('; ')} for ${OWNER_WORKSPACE}.`)
  }
}

if (import.meta.main)
  await new WorkspaceLibrarySeeder().run()
