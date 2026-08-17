import type { ReputationPlatform } from '../Actions/Reputation/platforms'
import { log } from '@stacksjs/logging'
import { isUniqueViolation } from '@stacksjs/orm'
import { Job } from '@stacksjs/queue'
import { credentialFor, ProviderNotConfiguredError, ProviderRequestError, providerFor } from '../Actions/Reputation/providers'
import { classifyMention } from '../Actions/Reputation/sentiment'
import MonitoredProfile from '../Models/MonitoredProfile'
import ReputationMention from '../Models/ReputationMention'

interface SyncPayload {
  profileId: number
  teamId: number
}

/** How far back a first sync reaches when the profile has never seen a mention. */
const FIRST_SYNC_LOOKBACK_DAYS = 30
const PAGE_SIZE = 50
/** Consecutive failures before the profile stops being polled and asks for attention. */
const FAILURE_LIMIT = 5

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

/** Exponential backoff on repeated failure, capped so a recovered profile resumes promptly. */
function backoffMinutes(baseInterval: number, failures: number): number {
  return Math.min(baseInterval * 2 ** Math.min(failures, 4), 720)
}

export default new Job({
  name: 'SyncMonitoredProfile',
  description: 'Fetches new reviews and comments for one monitored profile',
  queue: 'integrations',
  tries: 3,
  backoff: [30, 120, 600],

  async handle(input: SyncPayload) {
    const profile = await MonitoredProfile.where('id', input.profileId).where('team_id', input.teamId).first()
    if (!profile || profile.status === 'paused') return { skipped: true }

    const platform = String(profile.platform) as ReputationPlatform
    const provider = providerFor(platform)

    // An unsupported platform is a configuration fact, not a transient fault:
    // say so on the profile and stop polling rather than retrying forever.
    if (!provider) {
      await MonitoredProfile.forceUpdate(profile.id, {
        status: 'unconfigured',
        lastError: `No connector is available for ${platform}`,
        lastPolledAt: new Date().toISOString(),
        nextPollAt: null,
      })
      return { skipped: true, reason: 'unsupported_platform' }
    }

    let secret: string
    try {
      secret = await credentialFor(input.teamId, provider)
    }
    catch (error) {
      if (error instanceof ProviderNotConfiguredError) {
        await MonitoredProfile.forceUpdate(profile.id, {
          status: 'unconfigured',
          lastError: error.message,
          lastPolledAt: new Date().toISOString(),
          nextPollAt: null,
        })
        return { skipped: true, reason: 'not_configured' }
      }
      throw error
    }

    const since = profile.last_mention_at
      ? String(profile.last_mention_at)
      : new Date(Date.now() - FIRST_SYNC_LOOKBACK_DAYS * 86_400_000).toISOString()

    try {
      const { mentions, cursor } = await provider.fetchMentions({
        externalId: String(profile.external_id),
        handle: profile.handle ? String(profile.handle) : null,
        cursor: profile.cursor ? String(profile.cursor) : null,
        since,
        limit: PAGE_SIZE,
        secret,
      })

      const fetchedAt = new Date().toISOString()
      let stored = 0
      let latestPostedAt = profile.last_mention_at ? String(profile.last_mention_at) : null

      for (const mention of mentions) {
        const { sentiment, score } = classifyMention({ body: mention.body, rating: mention.rating })
        try {
          await ReputationMention.forceCreate({
            team_id: input.teamId,
            monitored_profile_id: Number(profile.id),
            platform,
            kind: mention.kind,
            externalId: mention.externalId,
            authorName: mention.authorName,
            authorHandle: mention.authorHandle,
            body: mention.body,
            rating: mention.rating,
            sentiment,
            sentimentScore: score,
            language: mention.language,
            url: mention.url,
            status: 'new',
            raw: JSON.stringify(mention.raw),
            postedAt: mention.postedAt,
            fetchedAt,
          })
          stored++
        }
        catch (error) {
          // The (profile, external_id) unique index is the dedupe mechanism, so
          // a collision means we already have this mention and can move on.
          if (!isUniqueViolation(error)) throw error
        }

        if (!latestPostedAt || Date.parse(mention.postedAt) > Date.parse(latestPostedAt))
          latestPostedAt = mention.postedAt
      }

      await MonitoredProfile.forceUpdate(profile.id, {
        status: 'active',
        cursor,
        lastError: null,
        consecutiveFailures: 0,
        lastPolledAt: fetchedAt,
        lastMentionAt: latestPostedAt,
        nextPollAt: minutesFromNow(Number(profile.poll_interval_minutes) || 30),
      })

      return { stored, fetched: mentions.length }
    }
    catch (error) {
      const failures = Number(profile.consecutive_failures || 0) + 1
      const message = error instanceof Error ? error.message : String(error)
      const permanent = error instanceof ProviderRequestError && !error.retryable

      await MonitoredProfile.forceUpdate(profile.id, {
        status: permanent || failures >= FAILURE_LIMIT ? 'error' : 'active',
        consecutiveFailures: failures,
        lastError: message.slice(0, 500),
        lastPolledAt: new Date().toISOString(),
        nextPollAt: permanent || failures >= FAILURE_LIMIT
          ? null
          : minutesFromNow(backoffMinutes(Number(profile.poll_interval_minutes) || 30, failures)),
      })

      log.error(`[commshq:reputation] profile ${profile.id} sync failed: ${message}`)
      // A permanently broken profile is already parked; re-throwing would only
      // burn queue retries on a request that cannot succeed.
      if (permanent) return { failed: true, permanent: true }
      throw error
    }
  },
})
