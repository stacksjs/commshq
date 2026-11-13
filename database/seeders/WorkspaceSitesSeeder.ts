import { randomUUID } from 'node:crypto'
import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the owner workspace two link pages and two landing pages, so the
 * sites page has something to show locally.
 *
 * One draft and one archived of each kind: the two statuses offer different
 * steps on the page (Archive, Restore as draft). None is `published`. No
 * route serves a page, so a seeded published page would be a record claiming
 * something that is not true.
 *
 * Neither model declares `useSeeder`, so nothing else writes these.
 *
 * Never in production, which does not get pages nobody drafted.
 */

const LINK_PAGES = [
  {
    title: 'Find us everywhere',
    slug: 'links',
    bio: 'A weekly letter on making work people remember.',
    status: 'draft',
    links: [
      { label: 'Read the latest issue', url: 'https://example.com/latest' },
      { label: 'Subscribe', url: 'https://example.com/subscribe' },
      { label: 'Podcast', url: 'https://example.org/podcast' },
    ],
  },
  { title: 'Spring launch links', slug: 'spring-launch', bio: null, status: 'archived', links: [{ label: 'Launch notes', url: 'https://example.com/spring' }] },
] as const

const LANDING_PAGES = [
  { name: 'Reader welcome', slug: 'reader-welcome', status: 'draft', seo: { title: 'Welcome to Sunday Paper', description: 'What to expect in your inbox, and how to get more from it.' } },
  { name: 'Launch waitlist', slug: 'launch-waitlist', status: 'archived', seo: {} },
] as const

export default class WorkspaceSitesSeeder extends Seeder {
  static order = 19
  static tags = ['demo']

  async run(): Promise<void> {
    if (isProductionEnv()) {
      log.info(`[WorkspaceSitesSeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get pages nobody drafted.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspaceSitesSeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet.`)
      return
    }

    /*
     * All or nothing. A workspace that already has a page of either kind,
     * seeded or real, is left as it is: re-running the seed must not add a
     * second set.
     */
    const existing = await db.selectFrom('link_pages' as any).select(['id'] as any).where('team_id' as any, '=', teamId).executeTakeFirst()
      ?? await db.selectFrom('landing_pages' as any).select(['id'] as any).where('team_id' as any, '=', teamId).executeTakeFirst()
    if (existing) {
      log.info('[WorkspaceSitesSeeder] Nothing to add: this workspace already has a page.')
      return
    }

    const now = new Date().toISOString()
    for (const page of LINK_PAGES) {
      await db.insertInto('link_pages' as any).values({
        team_id: teamId,
        uuid: randomUUID(),
        title: page.title,
        slug: page.slug,
        bio: page.bio,
        links: JSON.stringify(page.links),
        theme: JSON.stringify({ style: 'editorial' }),
        status: page.status,
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    for (const page of LANDING_PAGES) {
      await db.insertInto('landing_pages' as any).values({
        team_id: teamId,
        uuid: randomUUID(),
        name: page.name,
        slug: page.slug,
        status: page.status,
        document: JSON.stringify({ blocks: [] }),
        seo: JSON.stringify(page.seo),
        published_at: null,
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    log.info(`[WorkspaceSitesSeeder] Added ${LINK_PAGES.length} link pages and ${LANDING_PAGES.length} landing pages for ${OWNER_WORKSPACE}, none published.`)
  }
}

if (import.meta.main)
  await new WorkspaceSitesSeeder().run()
