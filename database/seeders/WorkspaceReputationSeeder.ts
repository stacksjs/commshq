import { randomUUID } from 'node:crypto'
import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the owner workspace something to monitor, so the reputation page can be
 * seen working: two profiles, a spread of reviews, one rule and the alert it
 * raised.
 *
 * None of these four models declares `useSeeder`, deliberately on their part:
 * a mention belongs to a profile and an alert to a rule, and the model pass
 * builds rows one table at a time with no way to keep those four consistent.
 * So the set is written here, as one piece.
 *
 * Two things keep invented data from behaving like real data:
 *
 * - Both profiles and the rule are `paused`. `PollMonitoredProfiles` and
 *   `EvaluateReputationAlerts` only pick up `active` rows, so no job will
 *   call Google or Yelp for a listing that does not exist, and no rule will
 *   re-evaluate reviews nobody wrote and notify someone about them.
 * - It never runs in production, for the reason the other workspace seeders
 *   give: fabricated reviews in a real account are one screenshot away from
 *   being quoted.
 */

interface DemoMention {
  profile: 'google' | 'yelp'
  author: string
  body: string
  rating: number
  sentiment: 'positive' | 'neutral' | 'negative'
  score: number
  status: 'new' | 'triaged' | 'responded' | 'ignored'
  /** How long ago it was posted. Distinct per row, so newest-first is a total order. */
  hoursAgo: number
}

const PROFILES = {
  google: { platform: 'google_business', displayName: 'CommsHQ Demo Storefront', externalId: 'demo-google-storefront', locationLabel: 'Sample listing' },
  yelp: { platform: 'yelp', displayName: 'CommsHQ Demo Storefront', externalId: 'demo-yelp-storefront', locationLabel: 'Sample listing' },
} as const

const MENTIONS: readonly DemoMention[] = [
  { profile: 'google', author: 'Sample reviewer A', body: 'Order arrived two days late and nobody answered the support line.', rating: 1, sentiment: 'negative', score: -78, status: 'new', hoursAgo: 5 },
  { profile: 'yelp', author: 'Sample reviewer B', body: 'Friendly staff and the pickup was ready when they said it would be.', rating: 5, sentiment: 'positive', score: 71, status: 'new', hoursAgo: 11 },
  { profile: 'google', author: 'Sample reviewer C', body: 'The item was fine but the packaging was damaged on arrival.', rating: 3, sentiment: 'neutral', score: -8, status: 'new', hoursAgo: 26 },
  { profile: 'google', author: 'Sample reviewer D', body: 'Charged twice for one order. Still waiting on the refund.', rating: 1, sentiment: 'negative', score: -85, status: 'triaged', hoursAgo: 39 },
  { profile: 'yelp', author: 'Sample reviewer E', body: 'Great selection. Will come back.', rating: 4, sentiment: 'positive', score: 55, status: 'responded', hoursAgo: 58 },
  { profile: 'yelp', author: 'Sample reviewer F', body: 'Waited forty minutes past my appointment time.', rating: 2, sentiment: 'negative', score: -60, status: 'new', hoursAgo: 73 },
  { profile: 'google', author: 'Sample reviewer G', body: 'Does this location have parking?', rating: 4, sentiment: 'neutral', score: 3, status: 'ignored', hoursAgo: 97 },
  { profile: 'google', author: 'Sample reviewer H', body: 'Quick replacement after I reported the problem. Appreciated.', rating: 5, sentiment: 'positive', score: 68, status: 'responded', hoursAgo: 130 },
]

const RULE_NAME = 'Negative review spike (demo)'
const HOUR_MS = 3_600_000

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString()
}

export default class WorkspaceReputationSeeder extends Seeder {
  /** After the library seeder (order 11). It depends only on the workspace existing. */
  static order = 12
  static tags = ['demo']

  async run(): Promise<void> {
    if (isProductionEnv()) {
      log.info(`[WorkspaceReputationSeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get invented reviews.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspaceReputationSeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet.`)
      return
    }

    /*
     * All or nothing, keyed on the profiles. A workspace that already
     * monitors anything, demo or real, is left exactly as it is: adding
     * sample reviews beside real ones would be the worst outcome here, and
     * re-running the seed must not duplicate the set.
     */
    const existing = await db.selectFrom('monitored_profiles' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst()
    if (existing) {
      log.info('[WorkspaceReputationSeeder] Nothing to add: this workspace already monitors a profile.')
      return
    }

    const now = new Date().toISOString()
    const profileIds: Record<string, number> = {}

    for (const [key, profile] of Object.entries(PROFILES)) {
      await db.insertInto('monitored_profiles' as any).values({
        team_id: teamId,
        uuid: randomUUID(),
        platform: profile.platform,
        kind: 'business_listing',
        display_name: profile.displayName,
        external_id: profile.externalId,
        location_label: profile.locationLabel,
        status: 'paused',
        poll_interval_minutes: 30,
        consecutive_failures: 0,
        last_polled_at: hoursAgo(4),
        last_mention_at: hoursAgo(5),
        created_at: now,
        updated_at: now,
      } as any).execute()

      const row = await db.selectFrom('monitored_profiles' as any)
        .select(['id'] as any)
        .where('team_id' as any, '=', teamId)
        .where('platform' as any, '=', profile.platform)
        .where('external_id' as any, '=', profile.externalId)
        .executeTakeFirst() as { id: number } | undefined
      if (!row)
        throw new Error(`[WorkspaceReputationSeeder] The ${profile.platform} demo profile was not written.`)
      profileIds[key] = Number(row.id)
    }

    for (const [index, mention] of MENTIONS.entries()) {
      const posted = hoursAgo(mention.hoursAgo)
      const profile = PROFILES[mention.profile]
      await db.insertInto('reputation_mentions' as any).values({
        team_id: teamId,
        monitored_profile_id: profileIds[mention.profile],
        uuid: randomUUID(),
        platform: profile.platform,
        kind: 'review',
        external_id: `demo-review-${index + 1}`,
        author_name: mention.author,
        body: mention.body,
        rating: mention.rating,
        sentiment: mention.sentiment,
        sentiment_score: mention.score,
        language: 'en',
        status: mention.status,
        responded_at: mention.status === 'responded' ? hoursAgo(Math.max(1, mention.hoursAgo - 6)) : null,
        raw: JSON.stringify({ demo: true }),
        posted_at: posted,
        fetched_at: hoursAgo(4),
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    await db.insertInto('reputation_alert_rules' as any).values({
      team_id: teamId,
      uuid: randomUUID(),
      name: RULE_NAME,
      metric: 'negative_mention_count',
      comparator: 'gte',
      threshold: 3,
      window_minutes: 10_080,
      minimum_sample_size: 1,
      platforms: JSON.stringify([]),
      severity: 'warning',
      channels: JSON.stringify(['database']),
      cooldown_minutes: 360,
      status: 'paused',
      last_evaluated_at: hoursAgo(4),
      last_triggered_at: hoursAgo(4),
      created_at: now,
      updated_at: now,
    } as any).execute()

    const rule = await db.selectFrom('reputation_alert_rules' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .where('name' as any, '=', RULE_NAME)
      .executeTakeFirst() as { id: number } | undefined

    /* The alert states what the mentions above actually add up to: three
     * negative reviews in the window against a threshold of three. */
    const negatives = MENTIONS.filter(mention => mention.sentiment === 'negative').length
    await db.insertInto('reputation_alerts' as any).values({
      team_id: teamId,
      reputation_alert_rule_id: rule ? Number(rule.id) : null,
      uuid: randomUUID(),
      fingerprint: `demo-negative-spike-${teamId}`,
      metric: 'negative_mention_count',
      severity: 'warning',
      observed_value: negatives,
      threshold_value: 3,
      sample_size: MENTIONS.length,
      window_start: hoursAgo(168),
      window_end: hoursAgo(4),
      status: 'open',
      context: JSON.stringify({ demo: true }),
      notified_channels: JSON.stringify(['database']),
      created_at: hoursAgo(4),
      updated_at: now,
    } as any).execute()

    log.info(`[WorkspaceReputationSeeder] Added ${Object.keys(PROFILES).length} paused demo profiles, ${MENTIONS.length} sample reviews, 1 paused rule and 1 open alert for ${OWNER_WORKSPACE}.`)
  }
}

if (import.meta.main)
  await new WorkspaceReputationSeeder().run()
