import type { FetchMentionsInput, FetchMentionsResult, NormalizedMention, ReputationProvider } from './types'
import { readJson } from './types'

const ENDPOINT = 'https://api.yelp.com/v3/businesses'

/**
 * Yelp Fusion review client.
 *
 * Fusion returns review *excerpts* rather than full bodies, and the standard
 * business tier caps the response at three reviews per business. That is a
 * platform limit, not something the poller can page around, so the sync job
 * relies on the dedupe key to pick up only what is new between polls.
 *
 * @see https://docs.developer.yelp.com/reference/v3_business_reviews
 */
export function yelpProvider(): ReputationProvider {
  return {
    platform: 'yelp',
    credentialProvider: 'yelp',
    credentialHint: 'Store a Yelp Fusion API key as the credential value.',

    async fetchMentions(input: FetchMentionsInput): Promise<FetchMentionsResult> {
      const url = new URL(`${ENDPOINT}/${encodeURIComponent(input.externalId)}/reviews`)
      url.searchParams.set('limit', String(Math.min(input.limit, 50)))
      url.searchParams.set('sort_by', 'newest')

      const response = await fetch(url, {
        headers: { authorization: `Bearer ${input.secret}`, accept: 'application/json' },
      })
      const payload = await readJson(response, 'yelp')
      const reviews: any[] = Array.isArray(payload?.reviews) ? payload.reviews : []
      const sinceMs = input.since ? Date.parse(input.since) : null

      const mentions: NormalizedMention[] = []
      for (const review of reviews) {
        const externalId = String(review?.id || '').trim()
        if (!externalId) continue

        // Fusion returns "2024-05-02 11:04:31" in the business's local time,
        // with no offset. Treating it as UTC keeps ordering stable, which is
        // all the window arithmetic needs.
        const raw = String(review?.time_created || '').trim()
        const postedAt = raw ? new Date(`${raw.replace(' ', 'T')}Z`).toISOString() : new Date().toISOString()
        if (sinceMs !== null && Date.parse(postedAt) < sinceMs) continue

        const rating = Number(review?.rating)
        mentions.push({
          externalId,
          kind: 'review',
          authorName: review?.user?.name ? String(review.user.name) : null,
          authorHandle: review?.user?.id ? String(review.user.id) : null,
          body: String(review?.text || ''),
          rating: Number.isFinite(rating) && rating > 0 ? rating : null,
          url: review?.url ? String(review.url) : null,
          language: null,
          postedAt,
          raw: review as Record<string, unknown>,
        })
      }

      return { mentions, cursor: null }
    },
  }
}
