/**
 * Reading billing out of the application's own API.
 *
 * Two endpoints, both already published by `useApi` behind `auth` and `team`:
 * `/api/v1/usage-meters` and `/api/v1/subscriptions`. Both are read-only on
 * the model (`routes: ['index', 'show']`), so this page reads and never
 * writes.
 *
 * The billing page used to state a Business plan at $99 monthly, 84,219
 * emails sent, 24,816 contacts, an invoice address at a company that is in no
 * table, and a Visa ending 4242. None of it was read from anything. What
 * replaces it is what the two tables hold: the meters for each period, and
 * the subscription if there is one. Where a workspace has no subscription row
 * the page says so. There is no invoice, payment method or alert setting on
 * any model here, so the page shows none.
 */
import type { UsageMeterRow, UsageView } from './workspace-summary'
import { formatSeen } from './contacts-query'
import { formatMoney, toUsageView } from './workspace-summary'

export const USAGE_METERS_ENDPOINT = '/api/v1/usage-meters'
export const SUBSCRIPTIONS_ENDPOINT = '/api/v1/subscriptions'

/**
 * Enough rows for well over a year of history at five meters a period, in one
 * request. The page groups by period itself, so it needs whole periods rather
 * than a page boundary that cuts one in half.
 */
export const USAGE_METERS_PER_PAGE = 100

/** Newest period first, which is the order the period picker lists them in. */
export function usageMetersUrl(): string {
  const params = new URLSearchParams()
  params.set('per_page', String(USAGE_METERS_PER_PAGE))
  params.set('sort', '-period_start')
  return `${USAGE_METERS_ENDPOINT}?${params.toString()}`
}

export function subscriptionsUrl(): string {
  const params = new URLSearchParams()
  params.set('per_page', '25')
  params.set('sort', '-created_at')
  return `${SUBSCRIPTIONS_ENDPOINT}?${params.toString()}`
}

export interface UsagePeriod {
  /** The period's start timestamp, exactly as the rows carry it. */
  key: string
  label: string
  /** Whether the period's window contains the moment asked about. */
  current: boolean
}

/**
 * The words for a period.
 *
 * A calendar month reads as its name. Anything else reads as its two dates,
 * because calling a 14-day trial window "November" would misstate what the
 * allowance covers. Read in UTC, which is how the periods are stored: a local
 * reading turns "1 November 00:00Z" into 31 October west of Greenwich.
 */
export function periodLabel(start?: string | null, end?: string | null, locale?: string): string {
  const from = new Date(String(start ?? ''))
  const to = new Date(String(end ?? ''))
  if (Number.isNaN(from.getTime()))
    return 'Undated period'

  const wholeMonth = !Number.isNaN(to.getTime())
    && from.getUTCDate() === 1 && to.getUTCDate() === 1
    && (to.getUTCFullYear() * 12 + to.getUTCMonth()) - (from.getUTCFullYear() * 12 + from.getUTCMonth()) === 1

  if (wholeMonth)
    return from.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const day = (date: Date) => date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return Number.isNaN(to.getTime()) ? `From ${day(from)}` : `${day(from)} to ${day(to)}`
}

/**
 * The distinct periods in a set of meter rows, newest first.
 *
 * Rows without a parseable start are left out: they cannot be placed in a
 * period, and a picker entry reading "Invalid Date" helps nobody.
 */
export function toUsagePeriods(rows: UsageMeterRow[] | null | undefined, now: Date = new Date(), locale?: string): UsagePeriod[] {
  const at = now.getTime()
  const seen = new Map<string, UsagePeriod>()

  for (const row of rows ?? []) {
    const key = String(row?.period_start ?? '')
    const start = Date.parse(key)
    if (!Number.isFinite(start) || seen.has(key))
      continue
    const end = Date.parse(String(row?.period_end ?? ''))
    seen.set(key, {
      key,
      label: periodLabel(row.period_start, row.period_end, locale),
      current: Number.isFinite(end) && start <= at && at < end,
    })
  }

  return [...seen.values()].sort((left, right) => Date.parse(right.key) - Date.parse(left.key))
}

/**
 * Which period the page opens on: the one containing now, else the newest.
 * Empty when there are no periods at all.
 */
export function defaultPeriodKey(periods: UsagePeriod[]): string {
  return (periods.find(period => period.current) ?? periods[0])?.key ?? ''
}

/** The meters of one period, sorted by label. */
export function metersForPeriod(rows: UsageMeterRow[] | null | undefined, periodKey: string, locale?: string): UsageView[] {
  return (rows ?? [])
    .filter(row => String(row?.period_start ?? '') === periodKey)
    .map(row => toUsageView(row, locale))
    .sort((left, right) => left.label.localeCompare(right.label))
}

/** A subscription exactly as the generated endpoint returns it. */
export interface SubscriptionRow {
  id: number
  plan?: string | null
  provider_status?: string | null
  provider_type?: string | null
  unit_price?: number | null
  quantity?: number | null
  cancel_at_period_end?: boolean | number | null
  trial_ends_at?: string | null
  ends_at?: string | null
}

export interface SubscriptionView {
  id: number
  plan: string
  status: string
  /** Unit price times quantity, from minor units. No interval: the row has none. */
  price: string
  /** What is scheduled to happen to it, or an empty string when nothing is. */
  note: string
}

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Normalize one subscription row.
 *
 * Provider identifiers (`provider_id`, `provider_customer_id`,
 * `provider_price_id`) are never copied into the view. The page has no use
 * for them, and what is not in the view cannot end up in the markup.
 *
 * The price carries no "monthly": the row holds a unit price and a quantity
 * and no billing interval, so the interval is not this page's to state.
 */
export function toSubscriptionView(row: SubscriptionRow, locale?: string): SubscriptionView {
  const quantity = Math.max(1, Math.trunc(Number(row.quantity) || 1))
  const ends = formatSeen(row.ends_at, locale)
  const trial = formatSeen(row.trial_ends_at, locale)
  const cancelling = row.cancel_at_period_end === true || row.cancel_at_period_end === 1

  let note = ''
  if (ends !== '-')
    note = `Ends ${ends}`
  else if (cancelling)
    note = 'Cancels at the end of the period'
  else if (trial !== '-')
    note = `Trial ends ${trial}`

  return {
    id: row.id,
    plan: titleCase(String(row.plan || '')) || 'Unnamed plan',
    status: titleCase(String(row.provider_status || '')) || 'Unknown',
    price: formatMoney((Number(row.unit_price) || 0) * quantity, locale),
    note,
  }
}

export function toSubscriptionViews(body: { data?: SubscriptionRow[] } | null | undefined, locale?: string): SubscriptionView[] {
  return (body?.data ?? []).map(row => toSubscriptionView(row, locale))
}

/** What to tell someone when either request failed. */
export function billingErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see billing.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so there is no billing to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Billing could not be loaded because the API is not answering.'
  return `Billing could not be loaded (${status}).`
}
