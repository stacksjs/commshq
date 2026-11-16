import { randomUUID } from 'node:crypto'
import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the owner workspace three automations, so the automations page has
 * something to show locally.
 *
 * Two drafts and one archived, none on. Each draft shows a different state
 * of the step editor:
 *
 * - "New subscriber welcome" holds only steps that can run (two emails with
 *   a wait between them). It has no sender, because the demo sender is not
 *   verified, so the page says that is the one thing missing.
 * - "First purchase thank you" also holds an approval and an SMS step, kinds
 *   that cannot run yet, so the page shows how it refuses to turn on until
 *   they are removed.
 *
 * None is seeded on. Turning on freezes a version and sends real email to
 * real signups; that is a decision for a person, not a seed.
 *
 * `Automation` is the framework's model and declares no `useSeeder`.
 *
 * Never in production, which does not get automations nobody wrote.
 */

const AUTOMATIONS = [
  {
    name: 'New subscriber welcome',
    status: 'draft',
    nodes: [
      { id: 'welcome', type: 'send_email', config: { subject: 'Welcome aboard', body: 'Thanks for subscribing.\n\nEvery Sunday you will get one letter on making work people remember. Reply any time: a person reads every answer.' } },
      { id: 'wait-three-days', type: 'delay', config: { seconds: 259_200 } },
      { id: 'best-of', type: 'send_email', config: { subject: 'Three issues to start with', body: 'While you wait for Sunday, here are the three issues readers mention most.' } },
    ],
  },
  {
    name: 'First purchase thank you',
    status: 'draft',
    nodes: [
      { id: 'wait-an-hour', type: 'delay', config: { seconds: 3_600 } },
      { id: 'review-copy', type: 'approval', config: {} },
      { id: 'thank-you', type: 'send_email', config: { subject: 'Thank you for your order', body: 'Your order is on its way. If anything is not right, reply to this email.' } },
      { id: 'text-follow-up', type: 'send_sms', config: {} },
    ],
  },
  {
    name: 'Spring re-engagement',
    status: 'archived',
    nodes: [
      { id: 'check-in', type: 'send_email', config: { subject: 'Still want these?', body: 'It has been a while. If these letters are not for you any more, the link below stops them.' } },
    ],
  },
] as const

export default class WorkspaceAutomationsSeeder extends Seeder {
  static order = 15
  static tags = ['demo']

  async run(): Promise<void> {
    if (isProductionEnv()) {
      log.info(`[WorkspaceAutomationsSeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get automations nobody wrote.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspaceAutomationsSeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet.`)
      return
    }

    /*
     * All or nothing. A workspace that already has an automation, seeded or
     * real, is left as it is: re-running the seed must not add a second set.
     */
    const existing = await db.selectFrom('automations' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst()
    if (existing) {
      log.info('[WorkspaceAutomationsSeeder] Nothing to add: this workspace already has an automation.')
      return
    }

    const now = new Date().toISOString()
    for (const automation of AUTOMATIONS) {
      await db.insertInto('automations' as any).values({
        team_id: teamId,
        uuid: randomUUID(),
        name: automation.name,
        status: automation.status,
        version: 1,
        trigger: JSON.stringify({ type: 'subscriber_joined' }),
        graph: JSON.stringify({ nodes: automation.nodes, edges: [] }),
        published_at: null,
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    log.info(`[WorkspaceAutomationsSeeder] Added ${AUTOMATIONS.length} automations for ${OWNER_WORKSPACE}: two drafts and one archived.`)
  }
}

if (import.meta.main)
  await new WorkspaceAutomationsSeeder().run()
