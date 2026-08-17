import { afterEach, describe, expect, it } from 'bun:test'
import { googleBusinessProvider } from '../../app/Actions/Reputation/providers/google-business'
import { isSupported, providerFor, supportedPlatforms } from '../../app/Actions/Reputation/providers'
import { ProviderRequestError } from '../../app/Actions/Reputation/providers/types'
import { yelpProvider } from '../../app/Actions/Reputation/providers/yelp'

const realFetch = globalThis.fetch

interface Captured { url: string, headers: Record<string, string> }

/** Swap in a canned response and capture the request the provider actually made. */
function stubFetch(body: unknown, status = 200): Captured {
  const captured: Captured = { url: '', headers: {} }
  globalThis.fetch = (async (input: any, init: any) => {
    captured.url = String(input)
    captured.headers = Object.fromEntries(Object.entries((init?.headers || {}) as Record<string, string>))
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch
  return captured
}

afterEach(() => {
  globalThis.fetch = realFetch
})

const baseInput = { externalId: 'biz-1', handle: null, cursor: null, since: null, limit: 50, secret: 'token-123' }

describe('yelp provider', () => {
  it('authenticates with the Fusion key and asks for the newest reviews', async () => {
    const captured = stubFetch({ reviews: [] })
    await yelpProvider().fetchMentions(baseInput)

    expect(captured.url).toContain('https://api.yelp.com/v3/businesses/biz-1/reviews')
    expect(captured.url).toContain('sort_by=newest')
    expect(captured.headers.authorization).toBe('Bearer token-123')
  })

  it('normalizes a review into a mention', async () => {
    stubFetch({
      reviews: [{
        id: 'review-1',
        rating: 2,
        text: 'Slow service and a cold meal.',
        time_created: '2026-03-01 18:22:04',
        url: 'https://www.yelp.com/biz/example?hrid=review-1',
        user: { id: 'user-9', name: 'Alex' },
      }],
    })

    const { mentions } = await yelpProvider().fetchMentions(baseInput)
    expect(mentions).toHaveLength(1)
    expect(mentions[0]).toMatchObject({
      externalId: 'review-1',
      kind: 'review',
      rating: 2,
      authorName: 'Alex',
      authorHandle: 'user-9',
    })
    // The space separated local timestamp is read as UTC.
    expect(mentions[0]?.postedAt).toBe('2026-03-01T18:22:04.000Z')
  })

  it('drops reviews older than the requested cutoff', async () => {
    stubFetch({
      reviews: [
        { id: 'new', rating: 5, text: 'Great', time_created: '2026-03-05 10:00:00' },
        { id: 'old', rating: 1, text: 'Bad', time_created: '2026-01-05 10:00:00' },
      ],
    })

    const { mentions } = await yelpProvider().fetchMentions({ ...baseInput, since: '2026-02-01T00:00:00.000Z' })
    expect(mentions.map(mention => mention.externalId)).toEqual(['new'])
  })

  it('skips reviews with no identifier rather than inventing one', async () => {
    stubFetch({ reviews: [{ rating: 4, text: 'No id here', time_created: '2026-03-05 10:00:00' }] })
    const { mentions } = await yelpProvider().fetchMentions(baseInput)
    expect(mentions).toHaveLength(0)
  })

  it('marks a rate limit as retryable and a bad key as not', async () => {
    stubFetch({ error: 'slow down' }, 429)
    await expect(yelpProvider().fetchMentions(baseInput)).rejects.toMatchObject({ retryable: true })

    stubFetch({ error: 'bad key' }, 401)
    await expect(yelpProvider().fetchMentions(baseInput)).rejects.toMatchObject({ retryable: false })
  })

  it('rejects a non-JSON body', async () => {
    stubFetch('<html>maintenance</html>')
    await expect(yelpProvider().fetchMentions(baseInput)).rejects.toBeInstanceOf(ProviderRequestError)
  })
})

describe('google business provider', () => {
  const input = { ...baseInput, externalId: 'accounts/12/locations/34' }

  it('addresses the location resource and sends the access token', async () => {
    const captured = stubFetch({ reviews: [] })
    await googleBusinessProvider().fetchMentions(input)

    expect(captured.url).toContain('https://mybusiness.googleapis.com/v4/accounts/12/locations/34/reviews')
    expect(captured.headers.authorization).toBe('Bearer token-123')
  })

  it('translates the word star rating into a number', async () => {
    stubFetch({
      reviews: [{
        reviewId: 'g-1',
        starRating: 'TWO',
        comment: 'Long wait at the counter.',
        createTime: '2026-03-02T09:00:00Z',
        reviewer: { displayName: 'Sam' },
      }],
    })

    const { mentions } = await googleBusinessProvider().fetchMentions(input)
    expect(mentions[0]).toMatchObject({ externalId: 'g-1', rating: 2, authorName: 'Sam' })
  })

  it('leaves the rating null when the value is unrecognized', async () => {
    stubFetch({ reviews: [{ reviewId: 'g-2', starRating: 'STAR_RATING_UNSPECIFIED', comment: 'Hmm', createTime: '2026-03-02T09:00:00Z' }] })
    const { mentions } = await googleBusinessProvider().fetchMentions(input)
    expect(mentions[0]?.rating).toBeNull()
  })

  it('carries the page token forward when a full page was consumed', async () => {
    stubFetch({ reviews: [{ reviewId: 'g-3', starRating: 'FIVE', comment: 'Good', createTime: '2026-03-02T09:00:00Z' }], nextPageToken: 'page-2' })
    const { cursor } = await googleBusinessProvider().fetchMentions(input)
    expect(cursor).toBe('page-2')
  })

  it('stops paging once results predate the cutoff', async () => {
    stubFetch({
      reviews: [
        { reviewId: 'g-new', starRating: 'FIVE', comment: 'Recent', createTime: '2026-03-05T09:00:00Z' },
        { reviewId: 'g-old', starRating: 'ONE', comment: 'Old', createTime: '2026-01-05T09:00:00Z' },
      ],
      nextPageToken: 'page-2',
    })

    const { mentions, cursor } = await googleBusinessProvider().fetchMentions({ ...input, since: '2026-02-01T00:00:00.000Z' })
    expect(mentions.map(mention => mention.externalId)).toEqual(['g-new'])
    expect(cursor).toBeNull()
  })
})

describe('provider registry', () => {
  it('resolves the platforms that have a client', () => {
    expect(providerFor('yelp')?.platform).toBe('yelp')
    expect(providerFor('google_business')?.platform).toBe('google_business')
    expect(supportedPlatforms().sort()).toEqual(['google_business', 'yelp'])
  })

  it('reports platforms without a client as unsupported instead of returning nothing', () => {
    expect(providerFor('instagram')).toBeNull()
    expect(isSupported('instagram')).toBe(false)
  })
})
