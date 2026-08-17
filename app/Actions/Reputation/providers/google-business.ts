import type { FetchMentionsInput, FetchMentionsResult, NormalizedMention, ReputationProvider } from './types'
import { readJson } from './types'

const ENDPOINT = 'https://mybusiness.googleapis.com/v4'

/** Google returns the star rating as a word rather than a number. */
const STAR_RATINGS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

/**
 * Google Business Profile review client.
 *
 * `externalId` is the full resource name Google addresses reviews by,
 * `accounts/{account}/locations/{location}`, because a location id alone is
 * not routable. The credential holds an OAuth access token for the
 * `business.manage` scope; refreshing it is the connector's job, so a 401 here
 * surfaces as a non-retryable error and pauses the profile.
 *
 * @see https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list
 */
export function googleBusinessProvider(): ReputationProvider {
  return {
    platform: 'google_business',
    credentialProvider: 'google_business',
    credentialHint: 'Store an OAuth access token with the business.manage scope, and set the profile identifier to accounts/{account}/locations/{location}.',

    async fetchMentions(input: FetchMentionsInput): Promise<FetchMentionsResult> {
      const resource = input.externalId.trim().replace(/^\/+|\/+$/g, '')
      const url = new URL(`${ENDPOINT}/${resource}/reviews`)
      url.searchParams.set('pageSize', String(Math.min(input.limit, 50)))
      url.searchParams.set('orderBy', 'updateTime desc')
      if (input.cursor) url.searchParams.set('pageToken', input.cursor)

      const response = await fetch(url, {
        headers: { authorization: `Bearer ${input.secret}`, accept: 'application/json' },
      })
      const payload = await readJson(response, 'google_business')
      const reviews: any[] = Array.isArray(payload?.reviews) ? payload.reviews : []
      const sinceMs = input.since ? Date.parse(input.since) : null

      const mentions: NormalizedMention[] = []
      let reachedSince = false

      for (const review of reviews) {
        const externalId = String(review?.reviewId || '').trim()
        if (!externalId) continue

        const created = String(review?.createTime || review?.updateTime || '').trim()
        const postedAt = created ? new Date(created).toISOString() : new Date().toISOString()
        if (sinceMs !== null && Date.parse(postedAt) < sinceMs) {
          // Results are newest-first, so the first older row means the rest are older too.
          reachedSince = true
          break
        }

        mentions.push({
          externalId,
          kind: 'review',
          authorName: review?.reviewer?.displayName ? String(review.reviewer.displayName) : null,
          authorHandle: null,
          body: String(review?.comment || ''),
          rating: STAR_RATINGS[String(review?.starRating || '')] ?? null,
          url: review?.name ? `https://business.google.com/reviews/${encodeURIComponent(String(review.name))}` : null,
          language: null,
          postedAt,
          // The reply, when present, is what marks a review as already handled.
          raw: review as Record<string, unknown>,
        })
      }

      // Only keep paging while the page was fully consumed; once we hit the
      // `since` boundary there is nothing older worth requesting.
      const cursor = reachedSince ? null : (payload?.nextPageToken ? String(payload.nextPageToken) : null)
      return { mentions, cursor }
    },
  }
}
