/**
 * Reading the command center out of the application's own API.
 *
 * `routes/api.ts` already published `GET /api/v1/workspace`, behind the `auth`
 * and `team` middleware, answered by `app/Actions/Api/V1/WorkspaceSummaryAction`.
 * It already counted this team's contacts, campaigns, publications, running
 * automations and recent earnings. The command center ignored all of it and
 * rendered four literals: 1,284 new contacts, 84,219 messages delivered,
 * $18,460 attributed revenue, 12 active journeys. None of those numbers came
 * from anywhere, and a dashboard that invents its own figures is worse than an
 * empty one, because an empty one cannot be acted on by mistake.
 *
 * This module is the request and the shape it returns, in the same place and
 * for the same reasons as `contacts-query.ts`: the query and the formatting
 * can be unit-tested without a browser, and the page stays markup plus state.
 *
 * ## What the endpoint supplies, and what it does not
 *
 * Every number below is a `COUNT` or a `SUM` the action performs for the
 * caller's own team. There is no period comparison in it, so there are no
 * deltas on this page. The old tiles carried "+18.4%" and "99.1%" next to
 * figures nothing produced; a change badge needs a previous period, and
 * inventing one to decorate a real number would be the same bug in a smaller
 * font. When the action grows a comparison, the tiles can grow a delta.
 */

/** A usage meter exactly as the endpoint returns it: snake_case columns. */
export interface UsageMeterRow {
  key?: string | null
  quantity?: number | null
  included_quantity?: number | null
  period_start?: string | null
  period_end?: string | null
}

export interface WorkspaceSummary {
  workspace?: { id?: number, name?: string | null } | null
  /** Contacts whose status is `active`, which is the model's own term for reachable. */
  contacts?: number | null
  campaigns?: number | null
  /** Publications whose status is `active`. */
  publications?: number | null
  /** Automation step runs whose status is `running`. */
  activeRuns?: number | null
  /** Summed `net_amount` over the 20 most recent earnings, in minor units. */
  attributedRevenue?: number | null
  library?: { audiences?: number | null, segments?: number | null, templates?: number | null } | null
  usage?: UsageMeterRow[] | null
}

export interface WorkspaceSummaryResponse {
  data?: WorkspaceSummary | null
}

export const WORKSPACE_ENDPOINT = '/api/v1/workspace'

/**
 * What to call the workspace before the request lands, and if it has no name.
 *
 * The eyebrow said "Sunday Paper Co." for every account, which is a company
 * that exists in no table. A neutral word is not a downgrade from that; it is
 * the first time the line has been true.
 */
export const WORKSPACE_FALLBACK_NAME = 'This workspace'

export function workspaceName(summary?: WorkspaceSummary | null): string {
  const name = summary?.workspace?.name
  return typeof name === 'string' && name.trim() ? name.trim() : WORKSPACE_FALLBACK_NAME
}

/** A whole number with the reader's own thousands separators. */
export function formatCount(value?: number | null, locale?: string): string {
  const count = Number(value)
  if (!Number.isFinite(count))
    return '0'
  return Math.trunc(count).toLocaleString(locale)
}

/**
 * Money, from the minor units the column holds.
 *
 * `Earning` stores `grossAmount` / `feeAmount` / `netAmount` as plain numbers
 * with a separate three-letter `currency`, and does not say which unit. Its
 * sibling `Commission` carries the identical triple with factories of 10000,
 * 1000 and 9000, which is $100.00 less $10.00 leaving $90.00, and
 * `CommerceEvent.amount` seeds 1500 to 24000, which is $15 to $240. Both only
 * make sense as cents, so cents is what this divides by.
 *
 * Worth being explicit about: read as major units the same column would have
 * printed a hundred times the real figure, and a revenue number that is wrong
 * by 100x is the kind of thing a dashboard gets believed about.
 *
 * Rounded to whole units, because this is a summary tile and not a ledger.
 */
export function formatMoney(minorUnits?: number | null, locale?: string, currency = 'USD'): string {
  const minor = Number(minorUnits)
  const major = Number.isFinite(minor) ? minor / 100 : 0
  try {
    return major.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
  }
  catch {
    // An unknown currency code throws rather than falling back on its own.
    return `${formatCount(Math.round(major), locale)} ${currency}`
  }
}

export interface PulseTile {
  key: string
  label: string
  value: string
  /**
   * What the number counts, in the reader's words.
   *
   * Each note describes the filter the action applied, so the tile cannot
   * claim more than the query asked for. "Status is active" is checkable;
   * "+18.4% this month" was not.
   */
  note: string
  icon: string
}

/**
 * The five tiles, in the order the page shows them.
 *
 * Always five, and always in this order, whatever the response carried. A tile
 * that disappears when its count is zero leaves the reader comparing a
 * four-tile row today with a five-tile row tomorrow and no way to tell a zero
 * from a field the endpoint stopped sending.
 */
export function toPulseTiles(summary?: WorkspaceSummary | null, locale?: string): PulseTile[] {
  return [
    {
      key: 'contacts',
      label: 'Active contacts',
      value: formatCount(summary?.contacts, locale),
      note: 'Status is active',
      icon: 'i-hugeicons-contact-01',
    },
    {
      key: 'campaigns',
      label: 'Campaigns',
      value: formatCount(summary?.campaigns, locale),
      note: 'Every campaign, all time',
      icon: 'i-hugeicons-megaphone-02',
    },
    {
      key: 'publications',
      label: 'Publications',
      value: formatCount(summary?.publications, locale),
      note: 'Status is active',
      icon: 'i-hugeicons-news-01',
    },
    {
      key: 'activeRuns',
      label: 'Running automations',
      value: formatCount(summary?.activeRuns, locale),
      note: 'Steps in flight right now',
      icon: 'i-hugeicons-flowchart-01',
    },
    {
      key: 'revenue',
      label: 'Attributed revenue',
      value: formatMoney(summary?.attributedRevenue, locale),
      note: 'From the 20 most recent earnings',
      icon: 'i-hugeicons-money-receive-circle',
    },
  ]
}

/** The words for a meter, falling back to the key rather than hiding it. */
const METER_LABELS: Record<string, string> = {
  ai_generations: 'AI generations',
  contacts: 'Contacts',
  custom_domains: 'Custom domains',
  emails: 'Emails',
  sms_segments: 'SMS segments',
}

export function meterLabel(key?: string | null): string {
  const raw = String(key ?? '').trim()
  if (!raw)
    return 'Unknown meter'
  const known = METER_LABELS[raw]
  if (known)
    return known
  const spaced = raw.replace(/[_-]+/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export interface UsageView {
  key: string
  label: string
  used: number
  usedLabel: string
  /** Null when the plan records no allowance for this meter. */
  included: number | null
  allowanceLabel: string
  /** 0 to 100, or null when there is no allowance to be a fraction of. */
  percent: number | null
}

/**
 * The meters for the period containing `now`, in a stable order.
 *
 * The endpoint returns every period it holds, newest first, which for a
 * workspace a month old is two periods of the same five meters. Showing both
 * puts "Emails 0" on the page twice; picking the newest `period_start` instead
 * would show last month's allowance on the first of the month. So the period
 * is chosen by the clock: the row whose window contains now.
 *
 * Sorted by label rather than left in the endpoint's order, which is
 * `period_start` descending and therefore says nothing about the meters
 * within one period.
 */
export function toCurrentMeters(summary?: WorkspaceSummary | null, now: Date = new Date()): UsageView[] {
  const at = now.getTime()

  return (summary?.usage ?? [])
    .filter((row) => {
      const start = Date.parse(String(row?.period_start ?? ''))
      const end = Date.parse(String(row?.period_end ?? ''))
      if (!Number.isFinite(start) || !Number.isFinite(end))
        return false
      return start <= at && at < end
    })
    .map((row) => {
      const used = Math.max(0, Number(row?.quantity) || 0)
      const rawIncluded = Number(row?.included_quantity)
      const included = Number.isFinite(rawIncluded) && rawIncluded > 0 ? rawIncluded : null

      return {
        key: String(row?.key ?? ''),
        label: meterLabel(row?.key),
        used,
        usedLabel: formatCount(used),
        included,
        allowanceLabel: included === null
          // Not "unlimited": the column is null, which records no allowance
          // rather than permission to send forever.
          ? 'No allowance recorded'
          : `of ${formatCount(included)}`,
        percent: included === null ? null : Math.min(100, Math.round((used / included) * 100)),
      }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

export interface LibraryEntry {
  key: string
  label: string
  count: number
  countLabel: string
  /** The page that lists these, where one exists. */
  href?: string
}

/**
 * What the workspace has to work with: audiences, segments, templates.
 *
 * Audiences carry no href on purpose. There are twenty dashboard pages and
 * none of them lists audiences: `audience.stx` is the contacts table, so
 * linking the audience count there would send the reader to a page that
 * answers a different question.
 */
export function toLibraryEntries(summary?: WorkspaceSummary | null, locale?: string): LibraryEntry[] {
  const library = summary?.library ?? {}
  const entries: LibraryEntry[] = [
    { key: 'audiences', label: 'Audiences', count: Math.max(0, Number(library.audiences) || 0), countLabel: '' },
    { key: 'segments', label: 'Segments', count: Math.max(0, Number(library.segments) || 0), countLabel: '', href: '/dashboard/commshq/segments' },
    { key: 'templates', label: 'Message templates', count: Math.max(0, Number(library.templates) || 0), countLabel: '', href: '/dashboard/commshq/editor' },
  ]

  return entries.map(entry => ({ ...entry, countLabel: formatCount(entry.count, locale) }))
}

/**
 * What to tell someone when the request failed.
 *
 * Split the same way `contacts-query.ts` splits it, and for the same reason:
 * the page gate already proved there is a session, so a 403 here is an account
 * that belongs to no active team, which signing in again does not repair.
 */
export function summaryErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your workspace.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so there is nothing to summarize.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'The workspace summary could not be loaded because the API is not answering.'
  return `The workspace summary could not be loaded (${status}).`
}
