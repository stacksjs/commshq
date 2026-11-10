/**
 * Reading the contacts list out of the application's own API.
 *
 * `Contact` declares `useApi: { prefix: 'v1', uri: 'contacts', middleware:
 * ['auth', 'team'] }`, so `/api/v1/contacts` already exists, is already
 * team-scoped by the auto-CRUD layer's `belongsTo: ['Team']`, and already
 * paginates. Nothing here is a new endpoint; this is the request the dashboard
 * makes and the shape it gets back, written down so the page can be read
 * without also reading the generator.
 *
 * It lives in a module rather than inside the page's `<script client>` so the
 * query building and row formatting can be unit-tested without a browser, and
 * so the page is markup plus state rather than markup plus string arithmetic.
 * stx registers an imported module on the page and the client script reads its
 * exports off that registry, which is why this import works from a `<script
 * client>` block at all.
 *
 * ## What the generated endpoint actually supports
 *
 * Measured against `@stacksjs/orm`'s route generator rather than the OpenAPI
 * document, which declares none of these:
 *
 *   page, per_page   1-based, with `per_page` clamped by the generator
 *   search           LIKE %term% across the FIRST FIVE `useSearch.searchable`
 *                    fields, which for Contact is email, firstName, lastName
 *   sort             comma-separated columns, `-` prefix for descending
 *   <column>=<value> any other known column becomes an equality filter, which
 *                    is where `status` comes from. There is no dedicated
 *                    filter syntax to learn.
 *
 * The response envelope is `{ data, ...paginator }`. `has_more_pages` is the
 * only paginator field read here: the generator's runtime spells the current
 * page `page` while its published type says `current_page`, and a page number
 * this module already knows is not worth depending on either spelling for.
 */

/** A contact exactly as the generated endpoint returns it: snake_case columns. */
export interface ContactRow {
  id: number
  uuid?: string
  email?: string | null
  phone?: string | null
  first_name?: string | null
  last_name?: string | null
  status?: string | null
  source?: string | null
  last_engaged_at?: string | null
  created_at?: string | null
}

export interface ContactListResponse {
  data?: ContactRow[]
  has_more_pages?: boolean
  total?: number
}

/** What the page asks for. */
export interface ContactQuery {
  page?: number
  perPage?: number
  search?: string
  /** One of the `status` enum values, or empty for every status. */
  status?: string
}

export const CONTACTS_ENDPOINT = '/api/v1/contacts'

export const CONTACTS_PER_PAGE = 25

/**
 * The statuses a contact can hold, as the model's own enum declares them,
 * paired with the words a person reading the table should see.
 *
 * `suppressed` is deliberately not shortened to "blocked": suppression here is
 * the consent ledger's decision and is what stops a send, so the table says the
 * same word the delivery path does.
 */
export const CONTACT_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'archived', label: 'Archived' },
] as const

/**
 * Build the listing URL.
 *
 * Empty values are left out rather than sent blank, because the generator
 * treats any unreserved parameter with a value as an equality filter: a bare
 * `status=` would be skipped today (it checks for a value) but `source=` next
 * to an empty input is one refactor away from filtering every row out.
 */
export function contactsUrl(query: ContactQuery = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? CONTACTS_PER_PAGE))))
  const search = (query.search ?? '').trim()
  if (search)
    params.set('search', search)
  if (query.status)
    params.set('status', query.status)
  // Newest first. The column is created_at, not createdAt: sort names columns.
  params.set('sort', '-created_at')
  return `${CONTACTS_ENDPOINT}?${params.toString()}`
}

/** A contact as the table renders it. */
export interface ContactView {
  id: number
  /** Their name, or the address itself when that is all we hold. */
  name: string
  /** The channel we can actually reach them on, preferring email. */
  address: string
  source: string
  status: string
  statusLabel: string
  lastSeen: string
}

/** The words for a status, falling back to the raw value rather than hiding it. */
export function statusLabel(status?: string | null): string {
  const known = CONTACT_STATUSES.find(item => item.value === status)
  return known ? known.label : (status || 'Unknown')
}

/**
 * A date a person can read, in their own locale, or an em-dash-free placeholder.
 *
 * A lone hyphen rather than "Never": a contact with no recorded engagement may
 * have been created a minute ago, and "Never" reads as a judgement about them
 * instead of an absence in our own data.
 */
export function formatSeen(value?: string | null, locale?: string): string {
  if (!value)
    return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return '-'
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Normalize one API row into the shape the table renders. */
export function toContactView(row: ContactRow, locale?: string): ContactView {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  const address = row.email || row.phone || ''
  return {
    id: row.id,
    name: name || address || `Contact ${row.id}`,
    address,
    source: row.source || 'Unknown',
    status: row.status || '',
    statusLabel: statusLabel(row.status),
    lastSeen: formatSeen(row.last_engaged_at, locale),
  }
}

/** Normalize a whole response, tolerating a body that carries no rows. */
export function toContactViews(body: ContactListResponse | null | undefined, locale?: string): ContactView[] {
  return (body?.data ?? []).map(row => toContactView(row, locale))
}

/**
 * What to tell someone when the request failed.
 *
 * The status is the whole difference between "your session ended" and "we are
 * broken", and the page says which rather than printing one apology for both.
 * 401 and 403 are separate: the page gate already proved the caller is signed
 * in, so a 403 here means the account belongs to no active team, which is a
 * different thing to fix and not something signing in again repairs.
 */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your contacts.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no contacts to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Contacts could not be loaded because the API is not answering.'
  return `Contacts could not be loaded (${status}).`
}
