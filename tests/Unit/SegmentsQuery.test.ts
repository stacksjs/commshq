/**
 * The segments listing request, the rows it turns into, and the create body.
 *
 * The case this file exists for is the size column. A segment row carries
 * `estimated_count`, and the seeded rows used to carry a random one between 80
 * and 6,800 in a workspace of 36 contacts, with no evaluator anywhere in the
 * application to have produced it. So a size is only printed when
 * `refreshed_at` records that an evaluation happened, and these tests hold the
 * page to that whatever number the row contains.
 */
import { describe, expect, test } from 'bun:test'
import {
  draftError,
  listErrorMessage,
  matchLabel,
  NOT_EVALUATED,
  saveErrorMessage,
  SEGMENT_DESCRIPTION_MAX,
  SEGMENT_MATCH_TYPES,
  SEGMENT_NAME_MAX,
  segmentPayload,
  SEGMENTS_ENDPOINT,
  SEGMENTS_PER_PAGE,
  segmentsUrl,
  toSegmentView,
  toSegmentViews,
} from '../../resources/data/segments-query'

/** The query half of a built URL, as a plain object. */
function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

describe('building the listing request', () => {
  test('it asks the endpoint the model publishes', () => {
    expect(SEGMENTS_ENDPOINT).toBe('/api/v1/segments')
    expect(segmentsUrl().startsWith(`${SEGMENTS_ENDPOINT}?`)).toBe(true)
  })

  test('it sorts by name, which is unique within a workspace', () => {
    // A total order, so a row cannot appear on two pages. created_at is not
    // one: rows from a single seed run or import share a timestamp.
    expect(params(segmentsUrl()).sort).toBe('name')
  })

  test('page one is the default and is not sent', () => {
    expect(params(segmentsUrl())).toEqual({ per_page: String(SEGMENTS_PER_PAGE), sort: 'name' })
    expect(params(segmentsUrl({ page: 3 })).page).toBe('3')
  })

  test('a nonsense page or size is clamped rather than sent', () => {
    expect(params(segmentsUrl({ page: -4, perPage: 0 }))).toEqual({ per_page: '1', sort: 'name' })
  })

  test('it sends no search, because the endpoint has nothing to search', () => {
    // Segment declares no useSearch fields, so a search parameter would be
    // ignored and every query would return every row.
    expect(params(segmentsUrl())).not.toHaveProperty('search')
  })
})

describe('a segment that has never been evaluated', () => {
  const unevaluated = { id: 7, name: 'High intent shoppers', description: 'Viewed pricing twice', match_type: 'all', estimated_count: 819, refreshed_at: null }

  test('it has no size, whatever number the row holds', () => {
    const view = toSegmentView(unevaluated, 'en-US')
    expect(view.evaluated).toBe(false)
    expect(view.sizeLabel).toBe(NOT_EVALUATED)
    expect(view.sizeLabel).not.toContain('819')
  })

  test('its evaluation date is the placeholder, not an invented one', () => {
    expect(toSegmentView(unevaluated, 'en-US').refreshedLabel).toBe('-')
  })

  test('an unparseable refresh time counts as never evaluated', () => {
    expect(toSegmentView({ ...unevaluated, refreshed_at: 'recently' }).evaluated).toBe(false)
  })
})

describe('a segment that has been evaluated', () => {
  const evaluated = { id: 8, name: 'New this week', match_type: 'any', estimated_count: 1824, refreshed_at: '2026-11-09T08:00:00.000Z' }

  test('it reports the size it was evaluated at', () => {
    const view = toSegmentView(evaluated, 'en-US')
    expect(view.evaluated).toBe(true)
    expect(view.sizeLabel).toBe('1,824')
    expect(view.refreshedLabel).toContain('2026')
  })

  test('an evaluated size of zero is a result, not an absence', () => {
    expect(toSegmentView({ ...evaluated, estimated_count: 0 }, 'en-US').sizeLabel).toBe('0')
  })
})

describe('normalizing rows', () => {
  test('it names the match type in words, and keeps an unknown one visible', () => {
    expect(SEGMENT_MATCH_TYPES.map(item => item.value)).toEqual(['all', 'any'])
    expect(matchLabel('all')).toBe('Every rule')
    expect(matchLabel('any')).toBe('Any rule')
    expect(matchLabel('some')).toBe('some')
    expect(matchLabel(null)).toBe('Unknown')
  })

  test('a row with no name still has something to call it', () => {
    expect(toSegmentView({ id: 12, name: '  ' }).name).toBe('Segment 12')
    expect(toSegmentView({ id: 12 }).description).toBe('')
  })

  test('a body with no rows is an empty list', () => {
    expect(toSegmentViews(null)).toEqual([])
    expect(toSegmentViews({})).toEqual([])
    expect(toSegmentViews({ data: [{ id: 1, name: 'One' }] })).toHaveLength(1)
  })
})

describe('creating a segment', () => {
  test('a name is required, within the limit the model declares', () => {
    expect(draftError({ name: '   ' })).toContain('needs a name')
    expect(draftError({ name: 'x'.repeat(SEGMENT_NAME_MAX) })).toBe('')
    expect(draftError({ name: 'x'.repeat(SEGMENT_NAME_MAX + 1) })).toContain(String(SEGMENT_NAME_MAX))
    expect(draftError({ name: 'Fine', description: 'x'.repeat(SEGMENT_DESCRIPTION_MAX + 1) })).toContain(String(SEGMENT_DESCRIPTION_MAX))
  })

  test('the body uses the column names and trims what was typed', () => {
    expect(segmentPayload({ name: '  Lapsed buyers ', description: ' No order in 90 days ', matchType: 'any' }))
      .toEqual({ name: 'Lapsed buyers', description: 'No order in 90 days', match_type: 'any' })
  })

  test('an empty description is null, and an unknown match type is the default', () => {
    expect(segmentPayload({ name: 'Lapsed buyers', description: '  ', matchType: 'most' }))
      .toEqual({ name: 'Lapsed buyers', description: null, match_type: 'all' })
  })

  test('the body never carries a size or an evaluation time', () => {
    // A size is the result of an evaluation, not something the form knows.
    const body = segmentPayload({ name: 'Lapsed buyers' }) as Record<string, unknown>
    expect(body).not.toHaveProperty('estimated_count')
    expect(body).not.toHaveProperty('refreshed_at')
  })
})

describe('explaining a failure', () => {
  test('listing separates an ended session from an account with no team', () => {
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(403)).toContain('not an active member')
    expect(listErrorMessage(500)).toContain('not answering')
    expect(listErrorMessage(418)).toContain('418')
  })

  test('saving names the duplicate, since the unique index is on the name', () => {
    expect(saveErrorMessage(409)).toContain('already has a segment with that name')
    expect(saveErrorMessage(422)).toContain('invalid')
    expect(saveErrorMessage(418)).toContain('418')
  })
})
