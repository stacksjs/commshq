import { randomUUID } from 'node:crypto'
import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the owner workspace three automations, so the automations page has
 * something to show locally.
 *
 * Two drafts and one archived: the page offers Archive on one and Restore on
 * the other, and a list of one status cannot show that it does. The graphs
 * carry nodes of the types `ProcessAutomationRun` knows (`delay`, `approval`)
 * beside message steps, so the step counts on the page are real counts.
 *
 * None is `active`. Nothing starts a run today, so an active row would look
 * live and do nothing; the page refuses to set that status for the same
 * reason, and seeding one would put on screen the state it will not create.
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
      { id: 'welcome', type: 'send_email', config: { subject: 'Welcome aboard' } },
      { id: 'wait-three-days', type: 'delay', config: { seconds: 259_200 } },
      { id: 'best-of', type: 'send_email', config: { subject: 'Three issues to start with' } },
    ],
  },
  {
    name: 'First purchase thank you',
    status: 'draft',
    nodes: [
      { id: 'wait-half-hour', type: 'delay', config: { seconds: 1_800 } },
      { id: 'review-copy', type: 'approval', config: {} },
      { id: 'thank-you', type: 'send_email', config: { subject: 'Thank you for your order' } },
      { id: 'text-follow-up', type: 'send_sms', config: {} },
    ],
  },
  {
    name: 'Spring re-engagement',
    status: 'archived',
    nodes: [
      { id: 'check-in', type: 'send_email', config: { subject: 'Still want these?' } },
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
