/**
 * The analytics page: every figure is a count the server sent.
 *
 * The page it replaces stated retention, lifetime value and revenue by
 * channel for every account. The rules here are that the page and the
 * server agree on the periods, that a section the server did not send reads
 * as empty rather than as a number, and that the page keeps saying what it
 * does not measure for as long as nothing measures it.
 */
import { describe, expect, test } from 'bun:test'
import { ANALYTICS_PERIODS, analyticsPeriod, DEFAULT_PERIOD, periodStart, RECIPIENT_STATUSES } from '../../app/Support/workspaceAnalytics'
import {
  ANALYTICS_ENDPOINT,
  analyticsErrorMessage,
  analyticsUrl,
  dayLabel,
  DEFAULT_DAYS,
  NOT_MEASURED,
  periodDays,
  PERIODS,
  toAnalyticsView,
  toCount,
} from '../../resources/data/analytics-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

async function sourcesUnder(pattern: string): Promise<string[]> {
  const root = new URL('../../', import.meta.url).pathname
  const files = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root, absolute: true, onlyFiles: true }))
  return Promise.all(files.map(file => Bun.file(file).text()))
}

const NOW = new Date('2026-11-13T15:30:00.000Z')

describe('the request', () => {
  test('the page offers exactly the periods the server answers for', () => {
    expect(PERIODS.map(period => period.days)).toEqual([...ANALYTICS_PERIODS])
    expect(DEFAULT_DAYS).toBe(DEFAULT_PERIOD)
    expect(analyticsUrl(90)).toBe('/api/v1/workspace/analytics?days=90')
  })

  test('it is read from the app route, behind auth and team', async () => {
    expect(ANALYTICS_ENDPOINT).toBe('/api/v1/workspace/analytics')
    expect(await source('routes/api.ts')).toContain("route.get('/v1/workspace/analytics', 'Actions/Api/V1/WorkspaceAnalyticsAction').middleware('auth').middleware('team')")
  })

  test('a period that is not offered falls back to the default', () => {
    expect(analyticsPeriod('7')).toBe(7)
    expect(analyticsPeriod(90)).toBe(90)
    for (const value of [undefined, '', '365', '-7', '7.5', 'all', '30; drop table contacts'])
      expect(analyticsPeriod(value)).toBe(DEFAULT_PERIOD)
  })

  test('a period is whole UTC days ending today', () => {
    expect(periodStart(7, NOW)).toBe('2026-11-07T00:00:00.000Z')
    expect(periodStart(1, NOW)).toBe('2026-11-13T00:00:00.000Z')
    expect(periodDays(7, NOW)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
    // The page's first day is the server's first instant.
    expect(periodStart(90, NOW).slice(0, 10)).toBe(periodDays(90, NOW)[0])
  })
})

describe('the server', () => {
  test('every count is scoped to the team that asked', async () => {
    const support = await source('app/Support/workspaceAnalytics.ts')
    // One `selectFrom` per query, and each is followed by the team filter.
    const queries = support.match(/selectFrom\(/g)?.length ?? 0
    const scoped = support.match(/\.where\('team_id', '=', teamId\)/g)?.length ?? 0
    expect(queries).toBeGreaterThan(0)
    expect(scoped).toBe(queries)
  })

  test('it returns counts and names, never an address or a payload', async () => {
    const support = await source('app/Support/workspaceAnalytics.ts')
    for (const column of ['email', 'phone', 'recipient', 'payload', 'address_hash', 'ip_'])
      expect(support).not.toContain(`'${column}`)
  })

  test('the recipient outcomes are the model\'s own enum', async () => {
    const model = await source('app/Models/CampaignRecipient.ts')
    expect(model).toContain(`schema.enum([${RECIPIENT_STATUSES.map(status => `'${status}'`).join(', ')}])`)
  })

  test('still true: nothing records an open, a click or an attributed sale', async () => {
    // The page says these are not measured. The day application code starts
    // writing them, this fails and the page gets the numbers instead.
    const code = (await sourcesUnder('app/{Actions,Jobs,Support,Listeners}/**/*.ts')).join('\n')
    expect(code).not.toMatch(/DeliveryEvent\b|delivery_events|AttributionEvent\b|attribution_events/)
    expect(NOT_MEASURED).toContain('Opens, clicks')
    expect(await source('resources/components/CommsHQ/AnalyticsWorkspace.stx')).toContain('{{ notMeasured }}')
  })
})

const BODY = {
  data: {
    days: 7,
    since: '2026-11-07T00:00:00.000Z',
    until: NOW.toISOString(),
    contacts: {
      total: 1240,
      added: 5,
      byStatus: [{ status: 'unsubscribed', count: 40 }, { status: 'active', count: 1200 }, { status: 'bounced_hard', count: 0 }],
      byDay: [{ day: '2026-11-08', count: 1 }, { day: '2026-11-12', count: 4 }],
    },
    signups: { total: 9, byForm: [{ id: 2, name: 'Newsletter signup', count: 8 }, { id: 5, name: null, count: 1 }] },
    consent: { byAction: [{ action: 'confirmed', count: 6 }, { action: 'revoked', count: 2 }] },
    sending: {
      recipients: 110,
      outcomes: { queued: 0, sent: 100, delivered: 0, failed: 4, suppressed: 6, cancelled: 0 },
      campaigns: [{ id: 3, name: 'November issue', outcomes: { sent: 100, failed: 4, suppressed: 6 } }],
      campaignCount: 3,
    },
  },
}

describe('what the page shows', () => {
  test('the tiles are the server\'s counts', () => {
    const view = toAnalyticsView(BODY)
    expect(view.periodLabel).toBe('Last 7 days')
    expect(view.tiles.map(tile => [tile.label, tile.value])).toEqual([
      ['Contacts added', '5'],
      ['Form signups', '9'],
      ['Messages sent', '100'],
      ['Opt-outs', '2'],
    ])
    expect(view.tiles[0].note).toBe('1,240 in the workspace now')
    expect(view.tiles[2].note).toBe('Of 110 recipients')
  })

  test('the chart has every day of the period, empty ones included', () => {
    const view = toAnalyticsView(BODY)
    expect(view.growth.map(day => day.count)).toEqual([0, 1, 0, 0, 0, 4, 0])
    expect(view.growth[5].title).toBe('Nov 12: 4 contacts added')
    expect(view.growth[5].barStyle).toBe('height: 100%')
    expect(view.growth[1].title).toBe('Nov 8: 1 contact added')
    expect(view.growthSummary).toBe('5 contacts added in the last 7 days.')
  })

  test('rows with nothing in them are left out, and the largest fills the bar', () => {
    const view = toAnalyticsView(BODY)
    expect(view.contactStatuses.map(row => row.label)).toEqual(['Active', 'Unsubscribed'])
    expect(view.contactStatuses[0].barStyle).toBe('width: 100%')
    expect(view.outcomes.map(row => [row.label, row.count])).toEqual([['Sent', 100], ['Failed', 4], ['Skipped, no consent', 6]])
    expect(view.consent.map(row => row.label)).toEqual(['Opt-in confirmed', 'Opted out'])
  })

  test('a deleted form or campaign is named as one, and unlisted campaigns are counted', () => {
    const view = toAnalyticsView(BODY)
    expect(view.forms.map(row => row.label)).toEqual(['Newsletter signup', 'A form that was deleted'])
    expect(view.campaigns[0]).toMatchObject({ name: 'November issue', summary: '100 sent, 4 failed, 6 skipped, no consent' })
    expect(view.moreCampaigns).toBe(2)
  })

  test('a body with nothing in it is all zeros and empty lists', () => {
    for (const body of [null, undefined, {}, { data: null }, { data: {} }]) {
      const view = toAnalyticsView(body as any, 30)
      expect(view.days).toBe(30)
      expect(view.tiles.map(tile => tile.value)).toEqual(['0', '0', '0', '0'])
      expect(view.growth).toHaveLength(30)
      expect(view.hasGrowth).toBe(false)
      expect([view.contactStatuses, view.forms, view.consent, view.outcomes, view.campaigns]).toEqual([[], [], [], [], []])
    }
  })

  test('a count is a whole number of zero or more', () => {
    expect([toCount('12'), toCount(3.9), toCount(-4), toCount('many'), toCount(null), toCount(Number.POSITIVE_INFINITY)]).toEqual([12, 3, 0, 0, 0, 0])
    expect(dayLabel('2026-01-05')).toBe('Jan 5')
  })

  test('the user-visible text has no em-dash or en-dash', async () => {
    const text = `${await source('resources/data/analytics-query.ts')}${await source('resources/components/CommsHQ/AnalyticsWorkspace.stx')}`
    expect(text).not.toMatch(/[—–]/)
  })

  test('a failure is explained by its status', () => {
    expect(analyticsErrorMessage(401)).toContain('Sign in again')
    expect(analyticsErrorMessage(403)).toContain('not an active member')
    expect(analyticsErrorMessage(503)).toContain('not answering')
    expect(analyticsErrorMessage(418)).toContain('(418)')
  })
})
