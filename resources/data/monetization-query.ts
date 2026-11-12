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
 * ## What the page does not show, and why the ledger is usually empty
 *
 * Nothing in the application writes an earning yet. No payment, placement or
 * referral records one, so the ledger is empty until something does, and the
 * page says that instead of showing a zero that reads like a slow month.
 * For the same reason there is no fill rate, no referral income and no
 * payout: placements, inventory, offers and payouts have tables and nothing
 * behind them. A sponsor's status is a label on the record; it does not
 * start or stop anything.
 */
import { formatSeen } from './contacts-query'
import { formatMoney } from './workspace-summary'

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
}

/** Normalize one ledger entry. Amounts are minor units, as everywhere else. */
export function toEarningView(row: EarningRow, locale?: string): EarningView {
  const currency = (row.currency || 'USD').toUpperCase()
  return {
    id: row.id,
    sourceLabel: sourceLabel(row.source_type),
    netLabel: formatMoney(row.net_amount, locale, currency),
    detail: `${formatMoney(row.gross_amount, locale, currency)} gross, ${formatMoney(row.fee_amount, locale, currency)} in fees`,
    whenLabel: formatSeen(row.occurred_at, locale),
  }
}

export function toEarningViews(body: { data?: EarningRow[] } | null | undefined, locale?: string): EarningView[] {
  return (body?.data ?? []).map(row => toEarningView(row, locale))
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
