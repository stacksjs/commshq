/**
 * The reputation page's requests, rows and write bodies.
 *
 * The backend behind this page was already real. What these tests hold the
 * page to is not overstating it: only the two platforms that have a connector
 * are offered, a profile that has never synced says so, a mention with no
 * rating shows none, and the provider's raw payload never reaches the view.
 */
import { describe, expect, test } from 'bun:test'
import {
  actionErrorMessage,
  ALERTS_ENDPOINT,
  alertsUrl,
  CONNECTOR_PLATFORMS,
  decisionUrl,
  listErrorMessage,
  MENTIONS_ENDPOINT,
  MENTIONS_PER_PAGE,
  mentionsUrl,
  metricLabel,
  platformLabel,
  profileDraftError,
  profilePayload,
  profileSaveErrorMessage,
  PROFILES_ENDPOINT,
  profilesUrl,
  profileStatusLabel,
  sentimentLabel,
  toAlertView,
  toMentionView,
  toMentionViews,
  toProfileView,
  triageUrl,
} from '../../resources/data/reputation-query'
import { supportedPlatforms } from '../../app/Support/reputationProviders'

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

describe('the requests', () => {
  test('each list asks the endpoint its model publishes', () => {
    expect(profilesUrl().startsWith(`${PROFILES_ENDPOINT}?`)).toBe(true)
    expect(mentionsUrl().startsWith(`${MENTIONS_ENDPOINT}?`)).toBe(true)
    expect(alertsUrl().startsWith(`${ALERTS_ENDPOINT}?`)).toBe(true)
  })

  test('mentions come newest first with the id breaking ties', () => {
    // One sync writes many mentions, and reviews imported together can share
    // a posted time. Without a tiebreaker a row can land on two pages.
    expect(params(mentionsUrl())).toEqual({ per_page: String(MENTIONS_PER_PAGE), sort: '-posted_at,-id' })
  })

  test('sentiment is an equality filter, and an empty one is not sent', () => {
    expect(params(mentionsUrl({ sentiment: 'negative', page: 2 }))).toMatchObject({ sentiment: 'negative', page: '2' })
    expect(params(mentionsUrl({ sentiment: '' }))).not.toHaveProperty('sentiment')
  })

  test('the write routes are the ones routes/api.ts registers', () => {
    expect(triageUrl(41)).toBe('/api/v1/reputation-mentions/41/triage')
    expect(decisionUrl(7)).toBe('/api/v1/reputation-alerts/7/decision')
  })
})

describe('which platforms can be added', () => {
  test('exactly the ones that have a connector', () => {
    // The action answers 422 for a platform with no provider registered, so
    // the form must not offer one. Compared against the registry itself, so
    // adding a connector without offering it here fails this test.
    expect(CONNECTOR_PLATFORMS.map(item => item.value).sort()).toEqual([...supportedPlatforms()].sort())
  })

  test('every platform a mention can come from still has a name', () => {
    expect(platformLabel('google_business')).toBe('Google Business')
    expect(platformLabel('x')).toBe('X')
    expect(platformLabel('some_new_network')).toBe('Some new network')
    expect(platformLabel(null)).toBe('Unknown')
  })
})

describe('a monitored profile', () => {
  test('one that has never synced says so, with no poll date', () => {
    const view = toProfileView({ id: 3, platform: 'yelp', display_name: 'Harbor Cafe', status: 'unconfigured', location_label: 'Pier 4' }, 'en-US')
    expect(view.statusLabel).toBe('Waiting for first sync')
    expect(view.lastPolledLabel).toBe('-')
    expect(view.detail).toBe('Pier 4')
    expect(view.error).toBe('')
  })

  test('the connector error is shown only while the profile is failing', () => {
    const failing = { id: 4, platform: 'yelp', display_name: 'Harbor Cafe', status: 'error', last_error: 'Credential rejected' }
    expect(toProfileView(failing).error).toBe('Credential rejected')
    // A stale error on a profile that has since recovered is history, not state.
    expect(toProfileView({ ...failing, status: 'active' }).error).toBe('')
    expect(profileStatusLabel('active')).toBe('Monitoring')
  })
})

describe('a mention', () => {
  const review = { id: 9, platform: 'google_business', kind: 'review', author_name: 'Dana R.', body: ' Cold coffee. ', rating: 2, sentiment: 'negative', status: 'new', posted_at: '2026-11-08T10:00:00.000Z', raw: '{"secret":"payload"}', sentiment_score: -62 }

  test('reads as what was posted, by whom, where', () => {
    const view = toMentionView(review, 'en-US')
    expect(view.author).toBe('Dana R.')
    expect(view.platformLabel).toBe('Google Business')
    expect(view.kindLabel).toBe('Review')
    expect(view.body).toBe('Cold coffee.')
    expect(view.ratingLabel).toBe('2 of 5')
    expect(view.sentimentLabel).toBe('Negative')
    expect(view.statusLabel).toBe('New')
  })

  test('the raw payload and the score never reach the view', () => {
    const serialized = JSON.stringify(toMentionView(review as never, 'en-US'))
    expect(serialized).not.toContain('payload')
    expect(serialized).not.toContain('-62')
  })

  test('a mention with no rating or author shows neither, not a guess', () => {
    const view = toMentionView({ id: 10, platform: 'yelp', kind: 'comment', body: 'Hello', sentiment: 'unknown' }, 'en-US')
    expect(view.ratingLabel).toBe('')
    expect(view.author).toBe('Unknown author')
    expect(view.sentimentLabel).toBe('Not scored')
    expect(sentimentLabel(null)).toBe('Not scored')
  })

  test('a body with no rows is an empty list', () => {
    expect(toMentionViews(null)).toEqual([])
  })
})

describe('an alert', () => {
  test('states what was observed against what was allowed', () => {
    const view = toAlertView({ id: 2, metric: 'average_rating', severity: 'critical', observed_value: '3.40', threshold_value: 4.2, sample_size: 12, status: 'open' }, 'en-US')
    expect(view.title).toBe('Average rating')
    expect(view.detail).toBe('Observed 3.4 against a threshold of 4.2, across 12 mentions.')
    expect(view.severityLabel).toBe('Critical')
    expect(view.statusLabel).toBe('Open')
  })

  test('one mention is singular, and an unknown metric stays visible', () => {
    expect(toAlertView({ id: 3, metric: 'negative_mention_count', observed_value: 1, threshold_value: 1, sample_size: 1 }).detail).toContain('across 1 mention.')
    expect(metricLabel('reply_latency')).toBe('Reply latency')
  })
})

describe('adding a profile', () => {
  test('a name and the platform identifier are required, within the action’s limits', () => {
    expect(profileDraftError({ displayName: '', externalId: 'abc' })).toContain('needs a name')
    expect(profileDraftError({ displayName: 'Harbor Cafe', externalId: ' ' })).toContain('identifier')
    expect(profileDraftError({ displayName: 'x'.repeat(161), externalId: 'abc' })).toContain('160')
    expect(profileDraftError({ displayName: 'Harbor Cafe', externalId: 'x'.repeat(256) })).toContain('255')
    expect(profileDraftError({ displayName: 'Harbor Cafe', externalId: 'abc' })).toBe('')
  })

  test('the body is camelCase, as the hand-written action reads it', () => {
    expect(profilePayload({ platform: 'yelp', displayName: ' Harbor Cafe ', externalId: ' harbor-cafe-sf ' }))
      .toEqual({ platform: 'yelp', displayName: 'Harbor Cafe', externalId: 'harbor-cafe-sf' })
  })

  test('a platform with no connector is never sent', () => {
    expect(profilePayload({ platform: 'reddit', displayName: 'A', externalId: 'b' }).platform).toBe('google_business')
  })
})

describe('explaining a failure', () => {
  test('a refused write is a role answer, and is worded as one', () => {
    expect(profileSaveErrorMessage(403)).toContain('admin or owner')
    expect(profileSaveErrorMessage(409)).toContain('already monitored')
    expect(actionErrorMessage(403)).toContain('role')
    expect(actionErrorMessage(409)).toContain('already done')
    expect(actionErrorMessage(404)).toContain('no longer exists')
  })

  test('listing separates an ended session from an account with no team', () => {
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(403)).toContain('not an active member')
    expect(listErrorMessage(418)).toContain('418')
  })
})
