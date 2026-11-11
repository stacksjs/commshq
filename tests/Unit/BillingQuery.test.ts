/**
 * Billing: periods, the meters in them, and the subscription on record.
 *
 * The page this serves used to state a plan, a price, two usage figures and a
 * card number, none of them read from anything. The cases here are the ones
 * where the honest answer is an absence: no subscription, a period that is
 * not a calendar month, a row that cannot be dated.
 */
import { describe, expect, test } from 'bun:test'
import {
  billingErrorMessage,
  defaultPeriodKey,
  metersForPeriod,
  periodLabel,
  subscriptionsUrl,
  toSubscriptionView,
  toSubscriptionViews,
  toUsagePeriods,
  USAGE_METERS_PER_PAGE,
  usageMetersUrl,
} from '../../resources/data/billing-query'

const NOV = { period_start: '2026-11-01T00:00:00.000Z', period_end: '2026-12-01T00:00:00.000Z' }
const OCT = { period_start: '2026-10-01T00:00:00.000Z', period_end: '2026-11-01T00:00:00.000Z' }
const ROWS = [
  { key: 'emails', quantity: 0, included_quantity: 250000, ...NOV },
  { key: 'contacts', quantity: 1200, included_quantity: 25000, ...NOV },
  { key: 'sms_segments', quantity: 4, included_quantity: null, ...NOV },
  { key: 'emails', quantity: 90, included_quantity: 250000, ...OCT },
]
const DURING_NOVEMBER = new Date('2026-11-10T12:00:00.000Z')

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

describe('the requests', () => {
  test('meters come newest period first, in whole periods', () => {
    expect(usageMetersUrl().startsWith('/api/v1/usage-meters?')).toBe(true)
    expect(params(usageMetersUrl())).toEqual({ per_page: String(USAGE_METERS_PER_PAGE), sort: '-period_start' })
  })

  test('subscriptions come from the endpoint the model publishes', () => {
    expect(subscriptionsUrl().startsWith('/api/v1/subscriptions?')).toBe(true)
  })
})

describe('naming a period', () => {
  test('a calendar month reads as its name, in UTC', () => {
    // Stored as midnight UTC on the first. A local reading west of Greenwich
    // would call this October.
    expect(periodLabel(NOV.period_start, NOV.period_end, 'en-US')).toBe('November 2026')
    expect(periodLabel('2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 'en-US')).toBe('December 2026')
  })

  test('anything else reads as its two dates rather than as a month', () => {
    const label = periodLabel('2026-11-10T00:00:00.000Z', '2026-11-24T00:00:00.000Z', 'en-US')
    expect(label).toBe('Nov 10, 2026 to Nov 24, 2026')
  })

  test('a period with no end or no start says so', () => {
    expect(periodLabel('2026-11-10T00:00:00.000Z', null, 'en-US')).toBe('From Nov 10, 2026')
    expect(periodLabel('whenever', null)).toBe('Undated period')
  })
})

describe('listing periods', () => {
  test('each period appears once, newest first, with the current one marked', () => {
    const periods = toUsagePeriods(ROWS, DURING_NOVEMBER, 'en-US')
    expect(periods.map(period => period.label)).toEqual(['November 2026', 'October 2026'])
    expect(periods.map(period => period.current)).toEqual([true, false])
  })

  test('rows that cannot be dated are left out of the picker', () => {
    expect(toUsagePeriods([{ key: 'emails', period_start: 'soon' }], DURING_NOVEMBER)).toEqual([])
    expect(toUsagePeriods(null)).toEqual([])
  })

  test('the page opens on the current period, else the newest, else nothing', () => {
    expect(defaultPeriodKey(toUsagePeriods(ROWS, DURING_NOVEMBER))).toBe(NOV.period_start)
    expect(defaultPeriodKey(toUsagePeriods(ROWS, new Date('2027-06-01T00:00:00.000Z')))).toBe(NOV.period_start)
    expect(defaultPeriodKey([])).toBe('')
  })
})

describe('the meters of a period', () => {
  test('only that period, sorted by label', () => {
    expect(metersForPeriod(ROWS, NOV.period_start, 'en-US').map(meter => meter.label)).toEqual(['Contacts', 'Emails', 'SMS segments'])
    expect(metersForPeriod(ROWS, OCT.period_start, 'en-US').map(meter => meter.usedLabel)).toEqual(['90'])
  })

  test('usage, allowance and the absence of one read as on the command center', () => {
    const [contacts, , sms] = metersForPeriod(ROWS, NOV.period_start, 'en-US')
    expect(contacts?.percent).toBe(5)
    expect(contacts?.allowanceLabel).toBe('of 25,000')
    expect(sms?.percent).toBeNull()
    expect(sms?.allowanceLabel.toLowerCase()).not.toContain('unlimited')
  })

  test('an unknown period has no meters', () => {
    expect(metersForPeriod(ROWS, '')).toEqual([])
    expect(metersForPeriod(null, NOV.period_start)).toEqual([])
  })
})

describe('the subscription on record', () => {
  const row = { id: 3, plan: 'business', provider_status: 'active', provider_type: 'stripe', unit_price: 9900, quantity: 1, cancel_at_period_end: 0, provider_id: 'sub_secret', provider_customer_id: 'cus_secret' }

  test('the price is read from minor units and states no interval', () => {
    const view = toSubscriptionView(row, 'en-US')
    expect(view.plan).toBe('Business')
    expect(view.status).toBe('Active')
    expect(view.price).toBe('$99')
    // The row has no billing interval, so the page does not invent "monthly".
    expect(JSON.stringify(view).toLowerCase()).not.toContain('month')
  })

  test('quantity multiplies the unit price', () => {
    expect(toSubscriptionView({ ...row, quantity: 3 }, 'en-US').price).toBe('$297')
  })

  test('provider identifiers never reach the view', () => {
    const serialized = JSON.stringify(toSubscriptionView(row as never, 'en-US'))
    expect(serialized).not.toContain('sub_secret')
    expect(serialized).not.toContain('cus_secret')
  })

  test('what is scheduled is noted: an end, a cancellation, or a trial', () => {
    expect(toSubscriptionView({ ...row, ends_at: '2026-12-01T00:00:00.000Z' }, 'en-US').note).toContain('Ends')
    expect(toSubscriptionView({ ...row, cancel_at_period_end: true }, 'en-US').note).toBe('Cancels at the end of the period')
    expect(toSubscriptionView({ ...row, trial_ends_at: '2026-12-01T00:00:00.000Z' }, 'en-US').note).toContain('Trial ends')
    expect(toSubscriptionView(row, 'en-US').note).toBe('')
  })

  test('a row that names nothing still reads as something', () => {
    const view = toSubscriptionView({ id: 9 }, 'en-US')
    expect(view.plan).toBe('Unnamed plan')
    expect(view.status).toBe('Unknown')
    expect(view.price).toBe('$0')
  })

  test('no rows is an empty list, which the page reports as no subscription', () => {
    expect(toSubscriptionViews(null)).toEqual([])
    expect(toSubscriptionViews({ data: [] })).toEqual([])
  })
})

describe('explaining a failure', () => {
  test('it separates an ended session from an account with no team', () => {
    expect(billingErrorMessage(401)).toContain('Sign in again')
    expect(billingErrorMessage(403)).toContain('not an active member')
    expect(billingErrorMessage(418)).toContain('418')
  })
})
