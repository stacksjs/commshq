import { randomUUID } from 'node:crypto'
import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the owner workspace three sponsors, so the monetization page has
 * something to show locally.
 *
 * One active, one prospect and one paused: each status offers a different
 * step on the page, and a list of one status cannot show that it does.
 *
 * No earnings are seeded. The page's ledger is empty because nothing
 * records an earning yet, and it says so; invented income would hide the
 * one fact that panel exists to tell.
 *
 * Never in production, which does not get sponsors nobody added.
 */

const SPONSORS = [
  { name: 'Studio Supply Co.', email: 'partners@studiosupply.example', website: 'https://studiosupply.example/', status: 'active', notes: 'Primary newsletter placement. Renews in March.' },
  { name: 'Field Guide Press', email: 'hello@fieldguide.example', website: null, status: 'prospect', notes: null },
  { name: 'Northlight Paper', email: 'ads@northlight.example', website: 'https://northlight.example/', status: 'paused', notes: 'Paused until the spring catalog.' },
] as const

export default class WorkspaceSponsorsSeeder extends Seeder {
  static order = 18
  static tags = ['demo']

  async run(): Promise<void> {
    if (isProductionEnv()) {
      log.info(`[WorkspaceSponsorsSeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get sponsors nobody added.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspaceSponsorsSeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet.`)
      return
    }

    /*
     * All or nothing. A workspace that already has a sponsor, seeded or
     * real, is left as it is: re-running the seed must not add a second set.
     */
    const existing = await db.selectFrom('sponsors' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst()
    if (existing) {
      log.info('[WorkspaceSponsorsSeeder] Nothing to add: this workspace already has a sponsor.')
      return
    }

    const now = new Date().toISOString()
    for (const sponsor of SPONSORS) {
      await db.insertInto('sponsors' as any).values({
        team_id: teamId,
        uuid: randomUUID(),
        name: sponsor.name,
        contact_email: sponsor.email,
        website: sponsor.website,
        status: sponsor.status,
        notes: sponsor.notes,
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    log.info(`[WorkspaceSponsorsSeeder] Added ${SPONSORS.length} sponsors for ${OWNER_WORKSPACE}: one active, one prospect, one paused.`)
  }
}

if (import.meta.main)
  await new WorkspaceSponsorsSeeder().run()
