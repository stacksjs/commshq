import { randomUUID } from 'node:crypto'
import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the owner workspace three publications, so the publications page has
 * something to show locally.
 *
 * One active, one draft and one archived: each status offers a different
 * step on the page (Pause, Mark active, Restore as draft), and a list of one
 * status cannot show that it does.
 *
 * `Publication` declares no `useSeeder`, so nothing else writes these.
 *
 * Never in production, which does not get publications nobody started.
 */

const PUBLICATIONS = [
  { name: 'Sunday Paper', slug: 'sunday-paper', description: 'A weekly letter on making work people remember.', status: 'active', access: 'mixed' },
  { name: 'Field Notes', slug: 'field-notes', description: 'Short dispatches from the studio, for paying members.', status: 'draft', access: 'paid' },
  { name: 'Launch Diary', slug: 'launch-diary', description: null, status: 'archived', access: 'free' },
] as const

export default class WorkspacePublicationsSeeder extends Seeder {
  static order = 17
  static tags = ['demo']

  async run(): Promise<void> {
    if (isProductionEnv()) {
      log.info(`[WorkspacePublicationsSeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get publications nobody started.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspacePublicationsSeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet.`)
      return
    }

    /*
     * All or nothing. A workspace that already has a publication, seeded or
     * real, is left as it is: re-running the seed must not add a second set.
     */
    const existing = await db.selectFrom('publications' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst()
    if (existing) {
      log.info('[WorkspacePublicationsSeeder] Nothing to add: this workspace already has a publication.')
      return
    }

    const now = new Date().toISOString()
    for (const publication of PUBLICATIONS) {
      await db.insertInto('publications' as any).values({
        team_id: teamId,
        uuid: randomUUID(),
        name: publication.name,
        slug: publication.slug,
        description: publication.description,
        status: publication.status,
        access: publication.access,
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    log.info(`[WorkspacePublicationsSeeder] Added ${PUBLICATIONS.length} publications for ${OWNER_WORKSPACE}: one active, one draft, one archived.`)
  }
}

if (import.meta.main)
  await new WorkspacePublicationsSeeder().run()
