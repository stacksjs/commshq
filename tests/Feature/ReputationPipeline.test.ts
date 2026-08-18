/**
 * The reputation pipeline, exercised against real tables and the real job
 * handlers rather than mocks. Only the outbound provider HTTP call is stubbed.
 *
 * This suite exists because the unit tests could not have caught what it
 * caught. They stub `fetch` and test pure functions, so nothing crossed the
 * ORM boundary, and four separate framework defects sat behind that boundary:
 * guarded columns silently dropped on insert, force writes skipping
 * encryption, `make()` returning a promise on encrypted models, and
 * query-builder reads never decrypting. Every one of them broke this feature
 * in production while the unit suite stayed green.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { db } from '@stacksjs/database'
import EvaluateReputationAlerts from '../../app/Jobs/EvaluateReputationAlerts'
import PollMonitoredProfiles from '../../app/Jobs/PollMonitoredProfiles'
import SyncMonitoredProfile from '../../app/Jobs/SyncMonitoredProfile'
import IntegrationCredential from '../../app/Models/IntegrationCredential'
import MonitoredProfile from '../../app/Models/MonitoredProfile'
import ReputationAlert from '../../app/Models/ReputationAlert'
import ReputationAlertRule from '../../app/Models/ReputationAlertRule'
import ReputationMention from '../../app/Models/ReputationMention'

const stamp = Date.now()
const realFetch = globalThis.fetch

let teamId: number
let userId: number
let profileId: number
let requestedUrl = ''
let authHeader = ''

function stubProvider(reviews: unknown[], status = 200) {
  globalThis.fetch = (async (input: any, init: any) => {
    requestedUrl = String(input)
    authHeader = String((init?.headers || {}).authorization || '')
    return new Response(JSON.stringify({ reviews }), { status })
  }) as typeof fetch
}

/** Reads the column straight from SQL, bypassing every ORM read wrapper. */
async function rawColumn(table: string, column: string, id: number): Promise<unknown> {
  const row = await db.selectFrom(table as any).select([column] as any)
    .where('id' as any, '=', id).executeTakeFirst() as any
  return row?.[column]
}

const REVIEWS = [
  { id: `neg-1-${stamp}`, rating: 1, text: 'Rude staff and a cold meal.', time_created: '2026-08-17 09:00:00', url: 'https://yelp.com/r1', user: { id: 'u1', name: 'Dana' } },
  { id: `neg-2-${stamp}`, rating: 2, text: 'Waited an hour. Terrible.', time_created: '2026-08-17 09:30:00', url: 'https://yelp.com/r2', user: { id: 'u2', name: 'Rae' } },
  { id: `neg-3-${stamp}`, rating: 2, text: 'Order was completely wrong.', time_created: '2026-08-17 10:00:00', url: 'https://yelp.com/r3', user: { id: 'u3', name: 'Sam' } },
  { id: `pos-1-${stamp}`, rating: 5, text: 'Excellent service, spotless room.', time_created: '2026-08-17 10:30:00', url: 'https://yelp.com/r4', user: { id: 'u4', name: 'Kim' } },
]

beforeAll(async () => {
  const now = new Date().toISOString()

  teamId = Number((await db.insertInto('teams' as any).values({
    name: `Reputation Suite ${stamp}`, description: 'feature test', member_count: 1,
    status: 'active', created_at: now, updated_at: now, uuid: crypto.randomUUID(),
  } as any).returning(['id'] as any).executeTakeFirstOrThrow() as any).id)

  userId = Number((await db.insertInto('users' as any).values({
    name: 'Reputation Owner', email: `reputation-${stamp}@example.com`, password: 'x',
    two_factor_enabled: false, created_at: now, updated_at: now, uuid: crypto.randomUUID(),
  } as any).returning(['id'] as any).executeTakeFirstOrThrow() as any).id)

  await db.insertInto('team_members' as any).values({
    team_id: teamId, user_id: userId, role: 'owner', status: 'active',
    created_at: now, updated_at: now, uuid: crypto.randomUUID(),
  } as any).execute()

  profileId = Number((await MonitoredProfile.forceCreate({
    team_id: teamId, platform: 'yelp', kind: 'business_listing', displayName: 'Suite Diner',
    externalId: `suite-biz-${stamp}`, status: 'active', pollIntervalMinutes: 30,
    nextPollAt: now, consecutiveFailures: 0,
  } as any)).id)
})

afterAll(() => {
  globalThis.fetch = realFetch
})

describe('a profile with no credential', () => {
  it('is parked as unconfigured rather than reported healthy', async () => {
    const result = await SyncMonitoredProfile.handle({ profileId, teamId })
    expect((result as any)?.reason).toBe('not_configured')

    const profile = await MonitoredProfile.where('id', profileId).first()
    expect(profile?.status).toBe('unconfigured')
    // Read the column raw: a parked profile must have no next poll scheduled.
    expect(await rawColumn('monitored_profiles', 'next_poll_at', profileId)).toBeNull()
  })
})

describe('credential storage', () => {
  it('stores the secret encrypted and hands back plaintext on a non-id lookup', async () => {
    const created = await IntegrationCredential.forceCreate({
      team_id: teamId, provider: 'yelp', name: 'Suite Yelp key', encryptedValue: 'yelp-secret-token',
    } as any)
    expect(Number(created?.id)).toBeGreaterThan(0)

    expect(await rawColumn('integration_credentials', 'encrypted_value', Number(created.id))).not.toBe('yelp-secret-token')

    // The lookup the sync job actually performs: by team and provider, not id.
    const found = await IntegrationCredential.where('team_id', teamId).where('provider', 'yelp').first()
    // Both spellings must resolve: the declared name is what the app reads,
    // the column name is what the row is keyed by.
    expect(found?.encryptedValue).toBe('yelp-secret-token')
    expect((found as any)?.encrypted_value).toBe('yelp-secret-token')
  })
})

describe('syncing a profile', () => {
  beforeAll(async () => {
    await MonitoredProfile.forceUpdate(profileId, { status: 'active', nextPollAt: new Date().toISOString() })
    stubProvider(REVIEWS)
  })

  it('stores each new mention and calls the provider with the decrypted key', async () => {
    const result = await SyncMonitoredProfile.handle({ profileId, teamId })
    expect((result as any)?.stored).toBe(4)
    expect(requestedUrl).toContain('api.yelp.com/v3/businesses/')
    expect(authHeader).toBe('Bearer yelp-secret-token')
  })

  it('scores sentiment from the star ratings', async () => {
    const mentions = await ReputationMention.where('team_id', teamId).get()
    expect(mentions.filter((m: any) => m.sentiment === 'negative')).toHaveLength(3)
    expect(mentions.filter((m: any) => m.sentiment === 'positive')).toHaveLength(1)
  })

  it('leaves the profile active and rescheduled', async () => {
    const profile = await MonitoredProfile.where('id', profileId).first()
    expect(profile?.status).toBe('active')
    expect(Number(profile?.consecutiveFailures)).toBe(0)
    expect(profile?.nextPollAt).toBeTruthy()
    // Declared name and column name agree.
    expect(Number((profile as any)?.consecutive_failures)).toBe(0)
  })

  it('stores nothing new when the same reviews come back', async () => {
    const result = await SyncMonitoredProfile.handle({ profileId, teamId })
    expect((result as any)?.stored).toBe(0)
    expect(await ReputationMention.where('team_id', teamId).get()).toHaveLength(4)
  })
})

describe('provider failures', () => {
  it('treats a 429 as retryable: rethrows, counts it, backs off', async () => {
    globalThis.fetch = (async () => new Response('{"error":"rate limited"}', { status: 429 })) as typeof fetch

    let threw = false
    try { await SyncMonitoredProfile.handle({ profileId, teamId }) }
    catch { threw = true }
    expect(threw).toBe(true)

    const profile = await MonitoredProfile.where('id', profileId).first()
    expect(Number(profile?.consecutiveFailures)).toBe(1)
    expect(profile?.status).toBe('active')
  })

  it('treats a 401 as permanent: parks the profile instead of retrying', async () => {
    globalThis.fetch = (async () => new Response('{"error":"bad key"}', { status: 401 })) as typeof fetch

    const result = await SyncMonitoredProfile.handle({ profileId, teamId })
    expect((result as any)?.permanent).toBe(true)

    const profile = await MonitoredProfile.where('id', profileId).first()
    expect(profile?.status).toBe('error')
    expect(await rawColumn('monitored_profiles', 'next_poll_at', profileId)).toBeNull()
  })

  it('does not queue a parked profile', async () => {
    expect(((await PollMonitoredProfiles.handle()) as any)?.queued).toBe(0)
  })
})

describe('threshold alerting', () => {
  let ruleId: number

  beforeAll(async () => {
    globalThis.fetch = realFetch
    ruleId = Number((await ReputationAlertRule.forceCreate({
      team_id: teamId, name: `Suite negative spike ${stamp}`, metric: 'negative_mention_count',
      comparator: 'gte', threshold: 3, windowMinutes: 1_440, minimumSampleSize: 1,
      platforms: JSON.stringify([]), severity: 'critical', channels: JSON.stringify(['database']),
      cooldownMinutes: 360, status: 'active', nextEvaluationAt: new Date().toISOString(),
    } as any)).id)
  })

  it('raises one alert carrying the evidence behind it', async () => {
    const run = await EvaluateReputationAlerts.handle()
    expect((run as any)?.raised).toBeGreaterThanOrEqual(1)

    const alerts = await ReputationAlert.where('team_id', teamId).get()
    expect(alerts).toHaveLength(1)
    expect(Number(alerts[0].observedValue)).toBe(3)
    expect(Number(alerts[0].thresholdValue)).toBe(3)
    expect(alerts[0].severity).toBe('critical')
    expect(alerts[0].status).toBe('open')
    // Guarded column: it silently vanished before the ORM fix.
    expect(String(alerts[0].fingerprint || '')).toHaveLength(64)
  })

  it('delivers the alert in-app', async () => {
    const alerts = await ReputationAlert.where('team_id', teamId).get()
    expect(JSON.parse(String(alerts[0].notifiedChannels))).toContain('database')
    expect((await db.selectFrom('notifications' as any).select(['id'] as any).execute()).length).toBeGreaterThanOrEqual(1)
  })

  it('does not page twice for the same incident while cooling down', async () => {
    await ReputationAlertRule.forceUpdate(ruleId, { nextEvaluationAt: new Date(Date.now() - 60_000).toISOString() })

    const run = await EvaluateReputationAlerts.handle()
    expect((run as any)?.raised).toBe(0)
    expect(await ReputationAlert.where('team_id', teamId).get()).toHaveLength(1)
  })
})
