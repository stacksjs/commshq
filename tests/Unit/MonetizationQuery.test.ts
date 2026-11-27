/**
 * Sponsors and the earnings ledger.
 *
 * Two rules matter most. A sponsor's website is typed by one member and
 * shown to the others as a link, so only an http or https address may become
 * one. And the ledger is append-only and written in one place, the sponsor
 * payment action; a test holds that to the code, so a second writer is a
 * decision someone makes on purpose.
 */
import { describe, expect, test } from 'bun:test'
import {
  draftError,
  earningReverseUrl,
  EARNINGS_ENDPOINT,
  earningsUrl,
  formatAmount,
  listErrorMessage,
  localDate,
  MAX_PAYMENT_MINOR,
  parseAmount,
  paymentDraftError,
  paymentErrorMessage,
  paymentPayload,
  reverseErrorMessage,
  safeWebsite,
  saveErrorMessage,
  sourceLabel,
  sponsorIdOf,
  sponsorPaymentUrl,
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

  test('a payment is recorded under its sponsor', () => {
    expect(sponsorPaymentUrl(4)).toBe('/api/v1/sponsors/4/payments')
  })

  test('an entry is reversed under its own id', () => {
    expect(earningReverseUrl(12)).toBe('/api/v1/earnings/12/reverse')
  })

  test('recording a payment and reversing one are the only things that write the ledger', async () => {
    // When this fails, something else writes earnings: the empty-state copy,
    // the ledger's append-only promise and the summary's single-currency sum
    // should all be looked at again.
    const root = new URL('../../', import.meta.url).pathname
    const files = [
      ...await Array.fromAsync(new Bun.Glob('app/{Actions,Jobs,Listeners,Support}/**/*.ts').scan({ cwd: root, onlyFiles: true })),
      ...await Array.fromAsync(new Bun.Glob('routes/*.ts').scan({ cwd: root, onlyFiles: true })),
    ]
    const writers: string[] = []
    for (const file of files) {
      const text = await Bun.file(`${root}${file}`).text()
      if (/Earning\.(?:create|forceCreate|update|delete)\(|(?:insertInto|updateTable|deleteFrom)\('earnings'/.test(text))
        writers.push(file)
    }
    expect(writers.sort()).toEqual([
      'app/Actions/Api/V1/Monetization/RecordSponsorPaymentAction.ts',
      'app/Actions/Api/V1/Monetization/ReverseEarningAction.ts',
    ])
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
      detail: '$4,800 received, $480 in fees',
      whenLabel: 'Nov 1, 2026',
      reversal: false,
      reversed: false,
      canReverse: true,
    })
  })

  test('a reversal and the entry it cancels find each other', () => {
    const names = { 7: 'Studio Supply Co.' }
    const original = { id: 2, source_type: 'sponsorship', source_id: 'sponsor:7:8b1f0c2e-1d3a-4c5b-9e6f-0a1b2c3d4e5f', gross_amount: 125050, fee_amount: 3625, net_amount: 121425, currency: 'USD', occurred_at: '2026-11-20T12:00:00.000Z' }
    const reversal = { id: 3, source_type: 'sponsorship', source_id: 'reversal:2', gross_amount: -125050, fee_amount: -3625, net_amount: -121425, currency: 'USD', occurred_at: '2026-11-21T09:00:00.000Z' }
    const [first, second] = toEarningViews({ data: [reversal, original] }, 'en-US', names)
    expect(first).toMatchObject({ sourceLabel: 'Reversal of a payment from Studio Supply Co.', netLabel: '-$1,214.25', detail: 'Cancels the $1,214.25 entry from Nov 20, 2026', reversal: true, canReverse: false })
    expect(second).toMatchObject({ sourceLabel: 'Sponsorship from Studio Supply Co.', reversed: true, canReverse: false, detail: '$1,250.50 received, $36.25 in fees. Reversed' })
    expect(toEarningViews({ data: [original] }, 'en-US', names)[0]).toMatchObject({ reversed: false, canReverse: true })
    expect(toEarningViews({ data: [reversal] }, 'en-US', names)[0]).toMatchObject({ sourceLabel: 'Reversal', detail: 'Cancels an earlier entry' })
  })

  test('a failed reversal says why', () => {
    expect(reverseErrorMessage(403, 'Reversing earnings requires an admin or owner role')).toBe('Only an owner or admin can reverse earnings.')
    expect(reverseErrorMessage(403, 'CSRF token mismatch')).toContain('Reload the page')
    expect(reverseErrorMessage(409)).toContain('cannot be reversed')
    expect(reverseErrorMessage(404)).toContain('not in this workspace')
  })

  test('cents are shown when there are cents, and only then', () => {
    expect(formatAmount(1250, 'en-US')).toBe('$12.50')
    expect(formatAmount(125000, 'en-US')).toBe('$1,250')
    expect(formatAmount(null, 'en-US')).toBe('$0')
    expect(formatAmount(1250, 'en-US', 'NOPE')).toBe('12.50 NOPE')
  })

  test('a sponsor payment names its sponsor once the page knows it', () => {
    const row = { id: 2, source_type: 'sponsorship', source_id: 'sponsor:7:8b1f0c2e-1d3a-4c5b-9e6f-0a1b2c3d4e5f', gross_amount: 50000, fee_amount: 0, net_amount: 50000, currency: 'USD', occurred_at: '2026-11-20T12:00:00.000Z' }
    expect(sponsorIdOf(row.source_id)).toBe(7)
    expect(sponsorIdOf('order:7')).toBe(0)
    expect(sponsorIdOf(null)).toBe(0)
    expect(toEarningView(row, 'en-US', { 7: 'Studio Supply Co.' })).toMatchObject({ sourceLabel: 'Sponsorship from Studio Supply Co.', detail: '$500 received, no fees' })
    expect(toEarningView(row, 'en-US', { 8: 'Someone else' }).sourceLabel).toBe('Sponsorship')
    expect(toEarningViews({ data: [row] }, 'en-US', { 7: 'Studio' })[0]!.sourceLabel).toBe('Sponsorship from Studio')
  })

  test('sources read as words', () => {
    expect(sourceLabel('paid_publication')).toBe('Paid publication')
    expect(sourceLabel('some_new_kind')).toBe('Some new kind')
    expect(sourceLabel(null)).toBe('Unknown source')
    expect(toEarningViews(null)).toEqual([])
  })
})

describe('recording a payment', () => {
  const today = '2026-11-23'

  test('amounts are read as people type them, in cents', () => {
    expect(parseAmount('1,250')).toBe(125000)
    expect(parseAmount('$1250.5')).toBe(125050)
    expect(parseAmount(' 1250.50 ')).toBe(125050)
    expect(parseAmount('0.07')).toBe(7)
    for (const value of ['', 'abc', '-5', '1.234', '1e3', '12.', null, undefined])
      expect(parseAmount(value)).toBeNull()
  })

  test('the date field holds the browser\'s own day', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })

  test('a payment needs an amount and a day; fees are optional', () => {
    expect(paymentDraftError({ amount: '1,250', date: today }, today)).toBe('')
    expect(paymentDraftError({ amount: '1,250', fee: '36.25', date: today }, today)).toBe('')
    expect(paymentDraftError({ amount: '', date: today }, today)).toContain('amount received')
    expect(paymentDraftError({ amount: '0', date: today }, today)).toContain('amount received')
    expect(paymentDraftError({ amount: String(MAX_PAYMENT_MINOR / 100 + 1), date: today }, today)).toContain('extra zeros')
    expect(paymentDraftError({ amount: '100', fee: 'lots', date: today }, today)).toContain('fees as an amount')
    expect(paymentDraftError({ amount: '100', fee: '101', date: today }, today)).toContain('cannot be more')
    expect(paymentDraftError({ amount: '100', date: '' }, today)).toContain('Choose the day')
    expect(paymentDraftError({ amount: '100', date: '2026-11-24' }, today)).toContain('future')
    expect(paymentDraftError({ amount: '100', date: '1999-12-31' }, today)).toContain('before 2000')
  })

  test('the body carries cents, the day and the form\'s key', () => {
    expect(paymentPayload({ amount: '1,250', fee: '36.25', date: today }, 'k')).toEqual({ gross_amount: 125000, fee_amount: 3625, occurred_on: today, key: 'k' })
    expect(paymentPayload({ amount: '1,250', fee: ' ', date: today }, 'k').fee_amount).toBe(0)
  })

  test('a refusal says whether it was the role or the page', () => {
    expect(paymentErrorMessage(403, 'Recording earnings requires an admin or owner role')).toBe('Only an owner or admin can record earnings.')
    expect(paymentErrorMessage(403, 'CSRF token mismatch')).toContain('Reload the page')
    expect(paymentErrorMessage(404)).toContain('no longer exists')
    expect(paymentErrorMessage(500)).toContain('(500)')
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
