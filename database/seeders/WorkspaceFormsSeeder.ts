import { randomUUID } from 'node:crypto'
import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the owner workspace two signup forms, so the forms page has something
 * to show and the public signup path has something to post to locally.
 *
 * One is active and one is a draft, on purpose: the page treats them
 * differently (only an active form shows its public address and offers
 * Archive), and a list of one status cannot show that it does.
 *
 * `FormDefinition` declares no `useSeeder`, and could not usefully: a form
 * points at an audience, and the model pass leaves that null for the same
 * reason it leaves `team_id` null. So the pair is written here, with the
 * active form joined to the workspace's "Weekly readers" audience when that
 * exists.
 *
 * Never in production. An active form answers on a public endpoint, and a
 * seeded one would be a signup form nobody chose to publish.
 */

const FORMS = [
  {
    name: 'Newsletter signup',
    slug: 'newsletter-signup',
    kind: 'inline',
    status: 'active',
    audience: 'Weekly readers',
    document: { fields: [{ name: 'email', type: 'email', required: true }, { name: 'firstName', type: 'text', required: false }], listName: 'Weekly readers' },
  },
  {
    name: 'Product updates waitlist',
    slug: 'product-updates-waitlist',
    kind: 'landing_page',
    status: 'draft',
    audience: 'Product updates',
    document: { fields: [{ name: 'email', type: 'email', required: true }] },
  },
] as const

export default class WorkspaceFormsSeeder extends Seeder {
  /** After the library seeder (order 11), which is what gives the audiences an owner. */
  static order = 13
  static tags = ['demo']

  async run(): Promise<void> {
    if (isProductionEnv()) {
      log.info(`[WorkspaceFormsSeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get a form nobody published.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspaceFormsSeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet.`)
      return
    }

    /*
     * All or nothing. A workspace that already has a form, seeded or real, is
     * left as it is: re-running the seed must not add a second pair, and it
     * must not put sample forms beside ones somebody built.
     */
    const existing = await db.selectFrom('form_definitions' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst()
    if (existing) {
      log.info('[WorkspaceFormsSeeder] Nothing to add: this workspace already has a form.')
      return
    }

    const now = new Date().toISOString()
    for (const form of FORMS) {
      const audience = await db.selectFrom('audiences' as any)
        .select(['id'] as any)
        .where('team_id' as any, '=', teamId)
        .where('name' as any, '=', form.audience)
        .executeTakeFirst() as { id: number } | undefined

      await db.insertInto('form_definitions' as any).values({
        team_id: teamId,
        // Null when the audience is missing: SubscribeAction treats a form
        // with no audience as "create the contact, join nothing".
        audience_id: audience ? Number(audience.id) : null,
        uuid: randomUUID(),
        name: form.name,
        slug: form.slug,
        kind: form.kind,
        schema_document: JSON.stringify(form.document),
        double_opt_in: 1,
        status: form.status,
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    log.info(`[WorkspaceFormsSeeder] Added ${FORMS.length} forms for ${OWNER_WORKSPACE}: one active, one draft.`)
  }
}

if (import.meta.main)
  await new WorkspaceFormsSeeder().run()
