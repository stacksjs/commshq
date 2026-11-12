/**
 * Sponsors and the earnings ledger.
 *
 * Two rules matter most. A sponsor's website is typed by one member and
 * shown to the others as a link, so only an http or https address may become
 * one. And the page says the ledger is empty because nothing records an
 * earning yet; a test holds that claim to the code, so the wording is
 * revisited the day something does.
 */
import { describe, expect, test } from 'bun:test'
import {
  draftError,
  EARNINGS_ENDPOINT,
  earningsUrl,
  listErrorMessage,
  safeWebsite,
  saveErrorMessage,
  sourceLabel,
  SPONSOR_NAME_MAX,
  SPONSOR_NOTES_MAX,
  SPONSOR_STATUSES,
  sponsorPayload,
  SPONSORS_ENDPOINT,
  SPONSORS_PER_PAGE,
  sponsorsUrl,
  sponsorUrl,
  statusLabel,
  toEarningView,
  toEarningViews,
  toSponsorView,
  toSponsorViews,
} from '../../resources/data/monetization-query'

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

async function sourcesUnder(pattern: string): Promise<string[]> {
  const root = new URL('../../', import.meta.url).pathname
  const files = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root, absolute: true, onlyFiles: true }))
  return Promise.all(files.map(file => Bun.file(file).text()))
}

describe('the requests', () => {
  test('sponsors are listed by name then id, earnings newest first', () => {
    expect(SPONSORS_ENDPOINT).toBe('/api/v1/sponsors')
    expect(params(sponsorsUrl())).toEqual({ per_page: String(SPONSORS_PER_PAGE), sort: 'name,id' })
    expect(params(sponsorsUrl({ status: 'active', page: 2 }))).toMatchObject({ status: 'active', page: '2' })
    expect(params(sponsorsUrl({ status: '' }))).not.toHaveProperty('status')
    expect(sponsorUrl(4)).toBe('/api/v1/sponsors/4')
    expect(EARNINGS_ENDPOINT).toBe('/api/v1/earnings')
    expect(params(earningsUrl())).toEqual({ per_page: '10', sort: '-occurred_at,-id' })
  })

  test('the statuses are the model\'s own enum', async () => {
    const model = await Bun.file(new URL('../../app/Models/Sponsor.ts', import.meta.url)).text()
    expect(model).toContain(`schema.enum([${SPONSOR_STATUSES.map(item => `'${item.value}'`).join(', ')}])`)
  })

  test('still true: no application code records an earning', async () => {
    // When this fails, something writes the ledger, and the page's wording
    // about an empty one should be looked at again.
    const sources = [...await sourcesUnder('app/{Actions,Jobs,Listeners,Support}/**/*.ts'), ...await sourcesUnder('routes/*.ts')]
    for (const text of sources) {
      expect(text).not.toMatch(/Earning\.(?:create|forceCreate)\(/)
      expect(text).not.toMatch(/insertInto\('earnings'/)
    }
  })
})

describe('a website is only ever a web address', () => {
  test('http and https are kept, normalized', () => {
    expect(safeWebsite(' https://studio.example/about ')).toBe('https://studio.example/about')
    expect(safeWebsite('http://studio.example')).toBe('http://studio.example/')
  })

  test('anything else is no link at all', () => {
    for (const value of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', 'mailto:a@b.co', 'studio.example', '//studio.example', '', null, undefined])
      expect(safeWebsite(value)).toBe('')
  })

  test('a stored bad address renders as no link', () => {
    const view = toSponsorView({ id: 1, name: 'Bad', website: 'javascript:alert(1)' })
    expect(view.website).toBe('')
    expect(view.websiteLabel).toBe('')
  })
})

describe('a sponsor on the list', () => {
  test('it shows the contact, the site and where it stands', () => {
    const view = toSponsorView({ id: 1, name: 'Studio Supply Co.', contact_email: 'ads@studio.example', website: 'https://studio.example/partners', status: 'active', notes: ' Renews  in March. ', updated_at: '2026-11-10T09:00:00Z' }, 'en-US')
    expect(view).toMatchObject({ name: 'Studio Supply Co.', email: 'ads@studio.example', website: 'https://studio.example/partners', websiteLabel: 'studio.example', notes: 'Renews in March.', statusLabel: 'Active', updatedLabel: 'Nov 10, 2026' })
  })

  test('each status offers one forward step', () => {
    const step = (status: string) => {
      const view = toSponsorView({ id: 2, status })
      return [view.nextStatus, view.nextLabel, view.canBlock]
    }
    expect(step('prospect')).toEqual(['active', 'Mark active', true])
    expect(step('paused')).toEqual(['active', 'Mark active', true])
    expect(step('active')).toEqual(['paused', 'Pause', true])
    // Back as a prospect, never straight to active.
    expect(step('blocked')).toEqual(['prospect', 'Unblock', false])
    expect(step('odd')).toEqual(['', '', true])
  })

  test('labels cover the unknown and the missing', () => {
    expect(statusLabel(null)).toBe('Unknown')
    expect(toSponsorView({ id: 3, name: ' ' })).toMatchObject({ name: 'Sponsor 3', status: 'prospect', email: '' })
    expect(toSponsorViews(null)).toEqual([])
  })
})

describe('the ledger', () => {
  test('amounts are minor units, shown net with the gross and fees beside', () => {
    expect(toEarningView({ id: 1, source_type: 'sponsorship', gross_amount: 480000, fee_amount: 48000, net_amount: 432000, currency: 'usd', occurred_at: '2026-11-01T12:00:00Z' }, 'en-US')).toEqual({
      id: 1,
      sourceLabel: 'Sponsorship',
      netLabel: '$4,320',
      detail: '$4,800 gross, $480 in fees',
      whenLabel: 'Nov 1, 2026',
    })
  })

  test('sources read as words', () => {
    expect(sourceLabel('paid_publication')).toBe('Paid publication')
    expect(sourceLabel('some_new_kind')).toBe('Some new kind')
    expect(sourceLabel(null)).toBe('Unknown source')
    expect(toEarningViews(null)).toEqual([])
  })
})

describe('adding a sponsor', () => {
  const draft = { name: 'Studio Supply Co.', email: 'ads@studio.example' }

  test('a name and a contact email are enough', () => {
    expect(draftError(draft)).toBe('')
    expect(sponsorPayload(draft)).toEqual({ name: 'Studio Supply Co.', contact_email: 'ads@studio.example', status: 'prospect' })
  })

  test('it holds the fields to the model limits', () => {
    expect(draftError({ ...draft, name: 'a' })).toContain('at least 2')
    expect(draftError({ ...draft, name: 'n'.repeat(SPONSOR_NAME_MAX + 1) })).toContain(`at most ${SPONSOR_NAME_MAX}`)
    expect(draftError({ ...draft, email: 'nope' })).toContain('contact email')
    expect(draftError({ ...draft, website: 'javascript:alert(1)' })).toContain('https://')
    expect(draftError({ ...draft, website: 'studio.example' })).toContain('https://')
    expect(draftError({ ...draft, notes: 'n'.repeat(SPONSOR_NOTES_MAX + 1) })).toContain(`at most ${SPONSOR_NOTES_MAX}`)
  })

  test('the body is always a prospect, with a normalized website and no blanks', () => {
    expect(sponsorPayload({ name: ' Studio ', email: ' Ads@Studio.Example ', website: ' https://studio.example ', notes: ' Met at the fair. ' })).toEqual({
      name: 'Studio',
      contact_email: 'ads@studio.example',
      status: 'prospect',
      website: 'https://studio.example/',
      notes: 'Met at the fair.',
    })
    const bare = sponsorPayload({ ...draft, website: ' ', notes: '' })
    expect(bare).not.toHaveProperty('website')
    expect(bare).not.toHaveProperty('notes')
  })
})

describe('what it says back', () => {
  test('each failure names what happened', () => {
    expect(listErrorMessage(401, 'sponsors')).toContain('see your sponsors')
    expect(listErrorMessage(503, 'earnings')).toBe('Earnings could not be loaded because the API is not answering.')
    expect(saveErrorMessage(422)).toContain('invalid')
    expect(saveErrorMessage(404)).toContain('no longer exists')
    expect(saveErrorMessage(500)).toContain('(500)')
  })
})
