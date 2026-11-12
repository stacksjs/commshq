import { randomUUID } from 'node:crypto'
import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the owner workspace three campaigns, so the campaigns page has
 * something to show locally.
 *
 * Two drafts, one per channel, and one already sent: the page offers Send and
 * Cancel on a draft and nothing on a finished campaign, and a list of one
 * status cannot show that it does.
 *
 * None of them is `scheduled` or `sending`, on purpose. `DispatchDueCampaigns`
 * picks up every scheduled campaign that has come due, in every team, so a
 * seeded one would be handed to the send job on its own. A draft goes nowhere
 * until somebody presses Send, and the job skips a campaign that is `sent`.
 *
 * `Campaign` is the framework's model and declares `useSeeder`, but the model
 * pass leaves `team_id` null and picks statuses at random, `scheduled` and
 * `sending` among them. These rows are written here instead.
 *
 * Never in production, which does not get campaigns nobody wrote.
 */

const DAY_MS = 24 * 60 * 60 * 1000

const CAMPAIGNS = [
  {
    name: 'Sunday issue: a calmer week',
    type: 'email',
    status: 'draft',
    subject: 'A calmer way to make the work people remember',
    text: 'This week: a field guide to a sustainable creative pace, reader questions, and one desk object worth keeping.',
    audience: 'Weekly readers',
    sentDaysAgo: 0,
  },
  {
    name: 'Studio sale reminder',
    type: 'sms',
    status: 'draft',
    subject: null,
    text: 'The studio sale opens Saturday at 9. Reply STOP to opt out.',
    audience: 'Store customers',
    sentDaysAgo: 0,
  },
  {
    name: 'October product notes',
    type: 'email',
    status: 'sent',
    subject: 'What changed in October',
    text: 'Three changes this month, and what each one is for.',
    audience: 'Product updates',
    sentDaysAgo: 12,
  },
] as const

export default class WorkspaceCampaignsSeeder extends Seeder {
  /** After the library seeder (order 11), which is what gives the audiences an owner. */
  static order = 14
  static tags = ['demo']

  async run(): Promise<void> {
    if (isProductionEnv()) {
      log.info(`[WorkspaceCampaignsSeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get campaigns nobody wrote.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspaceCampaignsSeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet.`)
      return
    }

    /*
     * All or nothing. A workspace that already has a campaign, seeded or
     * real, is left as it is: re-running the seed must not add a second set,
     * and it must not put samples beside campaigns somebody wrote.
     */
    const existing = await db.selectFrom('campaigns' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst()
    if (existing) {
      log.info('[WorkspaceCampaignsSeeder] Nothing to add: this workspace already has a campaign.')
      return
    }

    const now = Date.now()
    for (const campaign of CAMPAIGNS) {
      const audience = await db.selectFrom('audiences' as any)
        .select(['id'] as any)
        .where('team_id' as any, '=', teamId)
        .where('name' as any, '=', campaign.audience)
        .executeTakeFirst() as { id: number } | undefined

      const changedAt = new Date(now - campaign.sentDaysAgo * DAY_MS).toISOString()
      await db.insertInto('campaigns' as any).values({
        team_id: teamId,
        uuid: randomUUID(),
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        subject: campaign.subject,
        text: campaign.text,
        // Null when the audience is missing, which the dispatch action reads
        // as every active contact. The page says so in those words.
        segment_definition: audience ? JSON.stringify({ audienceId: Number(audience.id) }) : null,
        sent_at: campaign.status === 'sent' ? changedAt : null,
        currency: 'USD',
        timezone: 'UTC',
        created_at: changedAt,
        updated_at: changedAt,
      } as any).execute()
    }

    log.info(`[WorkspaceCampaignsSeeder] Added ${CAMPAIGNS.length} campaigns for ${OWNER_WORKSPACE}: two drafts and one sent.`)
  }
}

if (import.meta.main)
  await new WorkspaceCampaignsSeeder().run()
