/**
 * Sponsors and earnings, through the application's own API.
 *
 * This page was the `monetization` area of `WorkspaceSurface`: $31,842 of
 * net earnings, a 72% sponsor fill rate, $4,218 of referral income and a
 * scheduled payout to an account ending 1842. None of it was read from
 * anywhere.
 *
 * Two things here are real. `Sponsor` publishes full CRUD at
 * `/api/v1/sponsors`, so the page lists sponsors, adds one and moves it
 * between statuses. `Earning` publishes a read-only list at
 * `/api/v1/earnings`, which is the ledger the command center already sums,
 * so the page shows its most recent entries.
 *
 * An owner or admin records a payment from a sponsor in that ledger
 * (`POST /api/v1/sponsors/{id}/payments`), with the amount, any fees and the
 * day it arrived. The ledger is append-only: a wrong entry is cancelled by
 * a reversal beside it (`POST /api/v1/earnings/{id}/reverse`), never
 * edited, and the right figure is recorded again.
 *
 * ## What the page does not show
 *
 * Sponsor payments are the only earnings anything records. Referral,
 * recommendation and subscription income have no writer, so there is no
 * fill rate, no referral income and no payout: placements, inventory, offers
 * and payouts have tables and nothing behind them. A sponsor's status is a
 * label on the record; it does not start or stop anything.
 */
import { formatSeen } from './contacts-query'

export const SPONSORS_ENDPOINT = '/api/v1/sponsors'
export const EARNINGS_ENDPOINT = '/api/v1/earnings'
export const SPONSORS_PER_PAGE = 25
export const EARNINGS_SHOWN = 10

/** The limits the model's own validation declares. */
export const SPONSOR_NAME_MIN = 2
export const SPONSOR_NAME_MAX = 180
export const SPONSOR_EMAIL_MAX = 255
export const SPONSOR_WEBSITE_MAX = 2048
export const SPONSOR_NOTES_MAX = 4000

export const SPONSOR_STATUSES = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'blocked', label: 'Blocked' },
] as const

const SOURCE_LABELS: Record<string, string> = {
  paid_publication: 'Paid publication',
  sponsorship: 'Sponsorship',
  recommendation: 'Recommendation',
  digital_product: 'Digital product',
  referral: 'Referral',
}

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function statusLabel(status?: string | null): string {
  const known = SPONSOR_STATUSES.find(item => item.value === status)
  return known ? known.label : (status ? titleCase(String(status)) : 'Unknown')
}

export function sourceLabel(source?: string | null): string {
  return SOURCE_LABELS[String(source || '')] ?? (source ? titleCase(String(source)) : 'Unknown source')
}

/** Build the sponsors listing URL: by name, then id, since names are not unique. */
export function sponsorsUrl(query: { page?: number, perPage?: number, status?: string } = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? SPONSORS_PER_PAGE))))
  if (query.status)
    params.set('status', query.status)
  params.set('sort', 'name,id')
  return `${SPONSORS_ENDPOINT}?${params.toString()}`
}

export function sponsorUrl(id: number): string {
  return `${SPONSORS_ENDPOINT}/${Math.trunc(Number(id))}`
}

/** Where a sponsor's payment is recorded. */
export function sponsorPaymentUrl(id: number): string {
  return `${sponsorUrl(id)}/payments`
}

/** The most recent ledger entries, newest first. */
export function earningsUrl(): string {
  const params = new URLSearchParams()
  params.set('per_page', String(EARNINGS_SHOWN))
  params.set('sort', '-occurred_at,-id')
  return `${EARNINGS_ENDPOINT}?${params.toString()}`
}

/**
 * A website as a link the page can safely render: http or https only.
 *
 * A sponsor's website is typed by a member and shown to every other member
 * as a link, so a `javascript:` or `data:` address must never become an
 * href. Anything that is not a plain web address is shown as no link.
 */
export function safeWebsite(value?: string | null): string {
  const text = String(value ?? '').trim()
  if (!text)
    return ''
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  }
  catch {
    return ''
  }
}

export interface SponsorRow {
  id: number
  name?: string | null
  contact_email?: string | null
  website?: string | null
  status?: string | null
  notes?: string | null
  updated_at?: string | null
}

export interface SponsorView {
  id: number
  name: string
  email: string
  /** A safe http(s) address, or '' when there is none to link. */
  website: string
  websiteLabel: string
  notes: string
  status: string
  statusLabel: string
  updatedLabel: string
  /** The one forward step from this status, or '' when there is none. */
  nextStatus: string
  nextLabel: string
  canBlock: boolean
}

/**
 * The one forward step a status offers. A blocked sponsor comes back as a
 * prospect, never straight to active.
 */
const NEXT: Record<string, { status: string, label: string }> = {
  prospect: { status: 'active', label: 'Mark active' },
  paused: { status: 'active', label: 'Mark active' },
  active: { status: 'paused', label: 'Pause' },
  blocked: { status: 'prospect', label: 'Unblock' },
}

/** Normalize one sponsor row into the shape the list renders. */
export function toSponsorView(row: SponsorRow, locale?: string): SponsorView {
  const status = String(row.status || 'prospect')
  const next = NEXT[status]
  const website = safeWebsite(row.website)

  return {
    id: row.id,
    name: (row.name || '').trim() || `Sponsor ${row.id}`,
    email: (row.contact_email || '').trim(),
    website,
    websiteLabel: website ? new URL(website).host : '',
    notes: (row.notes || '').replace(/\s+/g, ' ').trim(),
    status,
    statusLabel: statusLabel(status),
    updatedLabel: formatSeen(row.updated_at, locale),
    nextStatus: next ? next.status : '',
    nextLabel: next ? next.label : '',
    canBlock: status !== 'blocked',
  }
}

export function toSponsorViews(body: { data?: SponsorRow[] } | null | undefined, locale?: string): SponsorView[] {
  return (body?.data ?? []).map(row => toSponsorView(row, locale))
}

export interface EarningRow {
  id: number
  source_type?: string | null
  source_id?: string | null
  net_amount?: number | null
  gross_amount?: number | null
  fee_amount?: number | null
  currency?: string | null
  occurred_at?: string | null
}

export interface EarningView {
  id: number
  sourceLabel: string
  netLabel: string
  detail: string
  whenLabel: string
  /** This entry cancels another. */
  reversal: boolean
  /** Another entry on the page cancels this one. */
  reversed: boolean
  canReverse: boolean
}

/**
 * Money from minor units, to the cent when there are cents.
 *
 * The summary tiles round to whole units; a ledger entry is the figure
 * someone typed in, so $12.50 must not read as $13.
 */
export function formatAmount(minorUnits?: number | null, locale?: string, currency = 'USD'): string {
  const minor = Number(minorUnits)
  const safe = Number.isFinite(minor) ? Math.trunc(minor) : 0
  const digits = safe % 100 === 0 ? 0 : 2
  try {
    return (safe / 100).toLocaleString(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
  }
  catch {
    // An unknown currency code throws rather than falling back on its own.
    return `${(safe / 100).toFixed(digits)} ${currency}`
  }
}

/** The sponsor a payment entry came from, or 0 when the entry is not one. */
export function sponsorIdOf(sourceId?: string | null): number {
  const match = /^sponsor:(\d+):/.exec(String(sourceId || ''))
  return match ? Number(match[1]) : 0
}

/** The entry a reversal cancels, or 0 when the entry is not a reversal. */
export function reversedIdOf(sourceId?: string | null): number {
  const match = /^reversal:(\d+)$/.exec(String(sourceId || ''))
  return match ? Number(match[1]) : 0
}

export function earningReverseUrl(id: number): string {
  return `${EARNINGS_ENDPOINT}/${Math.trunc(Number(id))}/reverse`
}

/**
 * Normalize one ledger entry. Amounts are minor units, as everywhere else.
 * `sponsorNames` names the sponsors the page has seen, so a payment reads
 * as coming from someone; an entry from a sponsor it has not seen still
 * reads as a sponsorship. `ledger` is the rest of the page's entries, which
 * is how a reversal and the entry it cancels find each other.
 */
export function toEarningView(row: EarningRow, locale?: string, sponsorNames: Record<number, string> = {}, ledger: EarningRow[] = [row]): EarningView {
  const currency = (row.currency || 'USD').toUpperCase()
  const money = (value?: number | null) => formatAmount(value, locale, currency)
  const sponsorOf = (entry: EarningRow) => (entry.source_type === 'sponsorship' ? sponsorNames[sponsorIdOf(entry.source_id)] ?? '' : '')
  const reversedId = reversedIdOf(row.source_id)

  if (reversedId) {
    const original = ledger.find(entry => entry.id === reversedId)
    const sponsor = original ? sponsorOf(original) : ''
    return {
      id: row.id,
      sourceLabel: sponsor ? `Reversal of a payment from ${sponsor}` : 'Reversal',
      netLabel: money(row.net_amount),
      detail: original
        ? `Cancels the ${money(original.net_amount)} entry from ${formatSeen(original.occurred_at, locale)}`
        : 'Cancels an earlier entry',
      whenLabel: formatSeen(row.occurred_at, locale),
      reversal: true,
      reversed: false,
      canReverse: false,
    }
  }

  const sponsor = sponsorOf(row)
  const fee = Number(row.fee_amount) || 0
  const reversed = ledger.some(entry => reversedIdOf(entry.source_id) === row.id)
  const amounts = fee > 0
    ? `${money(row.gross_amount)} received, ${money(fee)} in fees`
    : `${money(row.gross_amount)} received, no fees`
  return {
    id: row.id,
    sourceLabel: sponsor ? `Sponsorship from ${sponsor}` : sourceLabel(row.source_type),
    netLabel: money(row.net_amount),
    detail: reversed ? `${amounts}. Reversed` : amounts,
    whenLabel: formatSeen(row.occurred_at, locale),
    reversal: false,
    reversed,
    canReverse: !reversed,
  }
}

export function toEarningViews(body: { data?: EarningRow[] } | null | undefined, locale?: string, sponsorNames: Record<number, string> = {}): EarningView[] {
  const rows = body?.data ?? []
  return rows.map(row => toEarningView(row, locale, sponsorNames, rows))
}

/** What to tell someone when a reversal failed. */
export function reverseErrorMessage(status: number, error = ''): string {
  if (status === 403)
    return /role/i.test(error) ? 'Only an owner or admin can reverse earnings.' : 'That request was refused. Reload the page and try again.'
  if (status === 404)
    return 'That entry is not in this workspace\'s ledger. The list has been refreshed.'
  if (status === 409)
    return 'A reversal cannot be reversed. Record the payment again instead.'
  if (status === 401)
    return 'Your session has ended. Sign in again to reverse this entry.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  return `The entry could not be reversed (${status}).`
}

/** The largest single payment the server accepts: $10,000,000, in cents. */
export const MAX_PAYMENT_MINOR = 1_000_000_000

/**
 * An amount as typed, in cents: "1,250", "$1250.5" and "1250.50" are all
 * 125050. Null when it is not a plain amount with at most two decimals.
 */
export function parseAmount(text?: string | null): number | null {
  const cleaned = String(text ?? '').trim().replace(/^\$/, '').replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned))
    return null
  const [whole, fraction = ''] = cleaned.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

/** A date as the date field holds it, in the browser's own timezone. */
export function localDate(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface PaymentDraft {
  amount?: string
  fee?: string
  date?: string
}

/** Why a payment cannot be recorded yet, or '' when it can. */
export function paymentDraftError(draft: PaymentDraft, today: string): string {
  const gross = parseAmount(draft.amount)
  if (gross === null || gross < 1)
    return 'Enter the amount received, such as 1,250 or 1250.50.'
  if (gross > MAX_PAYMENT_MINOR)
    return 'That is more than one payment can be. Check for extra zeros.'
  const feeText = (draft.fee ?? '').trim()
  const fee = feeText ? parseAmount(feeText) : 0
  if (fee === null)
    return 'Enter the fees as an amount, such as 36.25, or leave them blank.'
  if (fee > gross)
    return 'The fees cannot be more than the amount received.'
  const date = (draft.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return 'Choose the day the payment arrived.'
  if (date > today)
    return 'The day the payment arrived cannot be in the future.'
  if (date < '2000-01-01')
    return 'Payments from before 2000 cannot be recorded here.'
  return ''
}

/** The request body for a payment. `key` makes a repeated save record it once. */
export function paymentPayload(draft: PaymentDraft, key: string): { gross_amount: number, fee_amount: number, occurred_on: string, key: string } {
  const feeText = (draft.fee ?? '').trim()
  return {
    gross_amount: parseAmount(draft.amount) ?? 0,
    fee_amount: feeText ? (parseAmount(feeText) ?? 0) : 0,
    occurred_on: (draft.date ?? '').trim(),
    key,
  }
}

/**
 * What to tell someone when a payment could not be recorded. A 403 is either
 * the role check or a stale page, and the server's error says which.
 */
export function paymentErrorMessage(status: number, error = ''): string {
  if (status === 403)
    return /role/i.test(error) ? 'Only an owner or admin can record earnings.' : 'That request was refused. Reload the page and try again.'
  if (status === 404)
    return 'That sponsor no longer exists. The list has been refreshed.'
  if (status === 422)
    return 'That payment was rejected as invalid. Check the amount, the fees and the day.'
  if (status === 401)
    return 'Your session has ended. Sign in again to record this payment.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  return `The payment could not be recorded (${status}).`
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What the create form holds. */
export interface SponsorDraft {
  name?: string
  email?: string
  website?: string
  notes?: string
}

/** Why a draft cannot be saved, against the limits the model declares. */
export function draftError(draft: SponsorDraft): string {
  const name = (draft.name ?? '').trim()
  const email = (draft.email ?? '').trim()
  const website = (draft.website ?? '').trim()
  const notes = (draft.notes ?? '').trim()
  if (name.length < SPONSOR_NAME_MIN)
    return `A sponsor name needs at least ${SPONSOR_NAME_MIN} characters.`
  if (name.length > SPONSOR_NAME_MAX)
    return `A sponsor name can be at most ${SPONSOR_NAME_MAX} characters.`
  if (!EMAIL.test(email) || email.length > SPONSOR_EMAIL_MAX)
    return 'A sponsor needs a contact email address.'
  if (website && (!safeWebsite(website) || website.length > SPONSOR_WEBSITE_MAX))
    return 'The website must be a web address starting with https:// or http://.'
  if (notes.length > SPONSOR_NOTES_MAX)
    return `Notes can be at most ${SPONSOR_NOTES_MAX} characters.`
  return ''
}

/**
 * The request body for a new sponsor. Always a prospect; blank optional
 * fields are left out, and a website is stored in its normalized form.
 */
export function sponsorPayload(draft: SponsorDraft): { name: string, contact_email: string, status: 'prospect', website?: string, notes?: string } {
  const payload: { name: string, contact_email: string, status: 'prospect', website?: string, notes?: string } = {
    name: (draft.name ?? '').trim(),
    contact_email: (draft.email ?? '').trim().toLowerCase(),
    status: 'prospect',
  }
  const website = safeWebsite(draft.website)
  if (website)
    payload.website = website
  const notes = (draft.notes ?? '').trim()
  if (notes)
    payload.notes = notes
  return payload
}

/** What to tell someone when a list failed. `what` is "sponsors" or "earnings". */
export function listErrorMessage(status: number, what: string): string {
  const title = what.charAt(0).toUpperCase() + what.slice(1)
  if (status === 401)
    return `Your session has ended. Sign in again to see your ${what}.`
  if (status === 403)
    return `This account is not an active member of a workspace, so it has no ${what} to show.`
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return `${title} could not be loaded because the API is not answering.`
  return `${title} could not be loaded (${status}).`
}

/** What to tell someone when a save failed. */
export function saveErrorMessage(status: number): string {
  if (status === 422)
    return 'That sponsor was rejected as invalid. Check the name, the email and the website.'
  if (status === 404)
    return 'That sponsor no longer exists. The list has been refreshed.'
  if (status === 401)
    return 'Your session has ended. Sign in again to save this sponsor.'
  if (status === 403)
    return 'That request was refused. Reload the page and try again.'
  return `The sponsor could not be saved (${status}).`
}
