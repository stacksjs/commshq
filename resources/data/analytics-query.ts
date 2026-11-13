/**
 * The analytics page: what a workspace did over a period, read from the API.
 *
 * This page was the `analytics` area of `WorkspaceSurface`. It told every
 * account it had 68.4% known visitors, 71.2% 30-day retention, a $48.20
 * reader LTV and $28,412 from "organic publication". Nothing in the
 * application records a visit, an open, a click or an attributed sale, so
 * those figures had no source.
 *
 * `GET /api/v1/workspace/analytics?days=N` counts the four things the
 * application does write (contacts added, form signups, consent changes and
 * campaign recipients), and this module turns the counts into what the page
 * shows. Every figure on the page is one of those counts or a sum of them.
 *
 * ## What the page does not show
 *
 * No opens, clicks, visits, retention, lifetime value, attribution or
 * revenue by channel. `NOT_MEASURED` says so on the page itself, so an
 * absent number is not read as a zero. No "Create report" button either:
 * there are no saved reports to create.
 */
export const ANALYTICS_ENDPOINT = '/api/v1/workspace/analytics'

/**
 * The periods on offer. The server falls back to its default for any other
 * value; a test holds this list equal to the server's.
 */
export const PERIODS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const

export const DEFAULT_DAYS = 30

export const NOT_MEASURED = 'Opens, clicks, site visits, retention and revenue attribution are not on this page. CommsHQ does not record them yet, so there is nothing to count.'

const DASHBOARD = '/dashboard/commshq'

export function analyticsUrl(days: number): string {
  return `${ANALYTICS_ENDPOINT}?days=${encodeURIComponent(String(days))}`
}

const CONTACT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending: 'Awaiting confirmation',
  unsubscribed: 'Unsubscribed',
  suppressed: 'Suppressed',
  archived: 'Archived',
}

const CONSENT_LABELS: Record<string, string> = {
  requested: 'Opt-in requested',
  confirmed: 'Opt-in confirmed',
  granted: 'Consent granted',
  revoked: 'Opted out',
  suppressed: 'Suppressed',
}

/** In the order a recipient moves through them. */
const OUTCOME_LABELS: Array<[key: string, label: string]> = [
  ['sent', 'Sent'],
  ['delivered', 'Delivered'],
  ['queued', 'Still queued'],
  ['failed', 'Failed'],
  ['suppressed', 'Skipped, no consent'],
  ['cancelled', 'Cancelled'],
]

export interface CountView {
  key: string
  label: string
  count: number
  countLabel: string
  /** 0 to 100, the share of the largest row, for the bar's width. */
  barStyle: string
}

export interface DayView {
  day: string
  count: number
  /** For the bar's tooltip and the screen-reader text. */
  title: string
  barStyle: string
}

export interface CampaignView {
  id: number
  name: string
  href: string
  summary: string
}

export interface AnalyticsView {
  days: number
  periodLabel: string
  tiles: Array<{ label: string, value: string, note: string }>
  growth: DayView[]
  growthSummary: string
  hasGrowth: boolean
  contactStatuses: CountView[]
  contactTotalLabel: string
  forms: CountView[]
  consent: CountView[]
  outcomes: CountView[]
  campaigns: CampaignView[]
  /** How many campaigns sent in the period are not in the list. */
  moreCampaigns: number
}

/** A count that is a whole number of zero or more; anything else is zero. */
export function toCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

export function formatCount(count: number): string {
  return count.toLocaleString('en-US')
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
}

function titleCase(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown'
}

function withBars(rows: Array<{ key: string, label: string, count: number }>): CountView[] {
  const largest = Math.max(1, ...rows.map(row => row.count))
  return rows.map(row => ({
    ...row,
    countLabel: formatCount(row.count),
    barStyle: `width: ${Math.round((row.count / largest) * 100)}%`,
  }))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-11-08` as `Nov 8`. The input is a UTC day, so no time zone applies. */
export function dayLabel(day: string): string {
  const [, month = 0, date = 0] = day.split('-').map(Number)
  return month >= 1 && month <= 12 && date >= 1 ? `${MONTHS[month - 1]} ${date}` : day
}

/**
 * Every day of the period, oldest first, whether or not anything happened on
 * it. The server only returns days that have rows; a chart that skipped the
 * empty ones would draw a quiet month as a busy week.
 */
export function periodDays(days: number, until: string | Date): string[] {
  const end = new Date(until)
  const last = Number.isNaN(end.getTime()) ? new Date() : end
  const cursor = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()))
  cursor.setUTCDate(cursor.getUTCDate() - (days - 1))
  const list: string[] = []
  for (let index = 0; index < days; index++) {
    list.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return list
}

interface AnalyticsBody {
  data?: {
    days?: unknown
    until?: unknown
    contacts?: { total?: unknown, added?: unknown, byStatus?: Array<{ status?: unknown, count?: unknown }> | null, byDay?: Array<{ day?: unknown, count?: unknown }> | null } | null
    signups?: { total?: unknown, byForm?: Array<{ id?: unknown, name?: unknown, count?: unknown }> | null } | null
    consent?: { byAction?: Array<{ action?: unknown, count?: unknown }> | null } | null
    sending?: { recipients?: unknown, outcomes?: Record<string, unknown> | null, campaigns?: Array<{ id?: unknown, name?: unknown, outcomes?: Record<string, unknown> | null }> | null, campaignCount?: unknown } | null
  } | null
}

function campaignSummary(outcomes: Record<string, unknown>): string {
  const parts = OUTCOME_LABELS
    .map(([key, label]) => ({ label, count: toCount(outcomes[key]) }))
    .filter(part => part.count > 0)
    .map(part => `${formatCount(part.count)} ${part.label.toLowerCase()}`)
  return parts.length ? parts.join(', ') : 'No recipients'
}

/**
 * Turn the server's counts into the page.
 *
 * A missing section reads as zeros, never as a guess: the page shows an
 * empty state for it rather than a figure the server did not send.
 */
export function toAnalyticsView(body: AnalyticsBody | null | undefined, fallbackDays: number = DEFAULT_DAYS): AnalyticsView {
  const data = body?.data ?? {}
  const offered = PERIODS.find(period => period.days === Number(data.days)) ?? PERIODS.find(period => period.days === fallbackDays) ?? PERIODS[1]
  const days = offered.days

  const contacts = data.contacts ?? {}
  const added = toCount(contacts.added)
  const perDay = new Map((contacts.byDay ?? []).map(row => [String(row.day ?? ''), toCount(row.count)]))
  const dayList = periodDays(days, typeof data.until === 'string' ? data.until : new Date())
  const busiest = Math.max(1, ...dayList.map(day => perDay.get(day) ?? 0))
  const growth = dayList.map((day) => {
    const count = perDay.get(day) ?? 0
    return {
      day,
      count,
      title: `${dayLabel(day)}: ${plural(count, 'contact', 'contacts')} added`,
      // A day with nothing keeps a hairline, so the axis reads as continuous.
      barStyle: `height: ${count === 0 ? 2 : Math.max(8, Math.round((count / busiest) * 100))}%`,
    }
  })

  const statuses = (contacts.byStatus ?? [])
    .map(row => ({ key: String(row.status ?? ''), count: toCount(row.count) }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(row => ({ ...row, label: CONTACT_STATUS_LABELS[row.key] ?? titleCase(row.key) }))
  const contactTotal = toCount(contacts.total)

  const signups = data.signups ?? {}
  const signupTotal = toCount(signups.total)
  const forms = (signups.byForm ?? [])
    .map(row => ({ key: String(row.id ?? ''), label: String(row.name ?? '').trim() || 'A form that was deleted', count: toCount(row.count) }))
    .filter(row => row.count > 0)

  const consentRows = (data.consent?.byAction ?? [])
    .map(row => ({ key: String(row.action ?? ''), count: toCount(row.count) }))
    .filter(row => row.count > 0)
    .map(row => ({ ...row, label: CONSENT_LABELS[row.key] ?? titleCase(row.key) }))
  const optedOut = consentRows.find(row => row.key === 'revoked')?.count ?? 0

  const sending = data.sending ?? {}
  const totals = sending.outcomes ?? {}
  const outcomes = OUTCOME_LABELS
    .map(([key, label]) => ({ key, label, count: toCount(totals[key]) }))
    .filter(row => row.count > 0)
  // Handed to the provider. `delivered` is a later state of the same message.
  const sent = toCount(totals.sent) + toCount(totals.delivered)
  const recipients = toCount(sending.recipients)

  const campaigns = (sending.campaigns ?? []).map(row => ({
    id: toCount(row.id),
    name: String(row.name ?? '').trim() || 'A campaign that was deleted',
    href: `${DASHBOARD}/campaigns`,
    summary: campaignSummary(row.outcomes ?? {}),
  }))

  return {
    days,
    periodLabel: offered.label,
    tiles: [
      { label: 'Contacts added', value: formatCount(added), note: `${formatCount(contactTotal)} in the workspace now` },
      { label: 'Form signups', value: formatCount(signupTotal), note: signupTotal === 0 ? 'No form was posted to' : `Across ${plural(forms.length, 'form', 'forms')}` },
      { label: 'Messages sent', value: formatCount(sent), note: recipients === 0 ? 'No campaign was sent' : `Of ${plural(recipients, 'recipient', 'recipients')}` },
      { label: 'Opt-outs', value: formatCount(optedOut), note: optedOut === 0 ? 'Nobody opted out' : 'Recorded in the consent ledger' },
    ],
    growth,
    growthSummary: added === 0 ? `No contacts were added in the ${offered.label.toLowerCase()}.` : `${plural(added, 'contact', 'contacts')} added in the ${offered.label.toLowerCase()}.`,
    hasGrowth: added > 0,
    contactStatuses: withBars(statuses),
    contactTotalLabel: plural(contactTotal, 'contact', 'contacts'),
    forms: withBars(forms),
    consent: withBars(consentRows),
    outcomes: withBars(outcomes),
    campaigns,
    moreCampaigns: Math.max(0, toCount(sending.campaignCount) - campaigns.length),
  }
}

/** What to tell someone when the counts could not be read. */
export function analyticsErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your analytics.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so there are no analytics to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Analytics could not be loaded because the API is not answering.'
  return `Analytics could not be loaded (${status}).`
}
