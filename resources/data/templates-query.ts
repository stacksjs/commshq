/**
 * Reading and writing message templates through the application's own API.
 *
 * `MessageTemplate` declares `useApi: { prefix: 'v1', uri: 'message-templates',
 * middleware: ['auth', 'team'] }`, so `/api/v1/message-templates` already
 * exists, is scoped to the caller's team, and paginates. Nothing here is a new
 * endpoint. Same arrangement as `contacts-query.ts` and `segments-query.ts`:
 * the request and the row formatting are testable without a browser.
 *
 * ## What a template row can honestly say
 *
 * The message studio page showed 34 reusable blocks, 12 templates across 4
 * channels and 186 draft revisions, none of which were counted from anything.
 * A row carries a `revision` number and a `document` holding its blocks, so
 * those two are reported per template, from the row. There is no approval
 * state, no preview status and no revision history on the model, so the page
 * shows none of them.
 *
 * No search, for the reason `segments-query.ts` records: the model declares no
 * `useSearch` fields. The channel filter is real, because any parameter naming
 * a column is an equality filter in the generated endpoint.
 */
import { formatSeen } from './contacts-query'
import { formatCount } from './workspace-summary'

/** A template exactly as the generated endpoint returns it: snake_case columns. */
export interface TemplateRow {
  id: number
  name?: string | null
  channel?: string | null
  subject?: string | null
  /** The block document, as a JSON string or already parsed. */
  document?: unknown
  revision?: number | null
  updated_at?: string | null
}

export interface TemplateListResponse {
  data?: TemplateRow[]
  has_more_pages?: boolean
  total?: number
}

export const TEMPLATES_ENDPOINT = '/api/v1/message-templates'

export const TEMPLATES_PER_PAGE = 25

/** The limits the model's own validation declares. */
export const TEMPLATE_NAME_MAX = 120
export const TEMPLATE_SUBJECT_MAX = 255

/** The channels a template can target, as the model's enum declares them. */
export const TEMPLATE_CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'landing_page', label: 'Landing page' },
] as const

/** The words for a channel, falling back to the raw value rather than hiding it. */
export function channelLabel(channel?: string | null): string {
  const known = TEMPLATE_CHANNELS.find(item => item.value === channel)
  return known ? known.label : (channel || 'Unknown')
}

/**
 * Build the listing URL.
 *
 * Sorted by name, which `message_templates_team_name_unique` makes a total
 * order within a workspace. An empty channel is left out rather than sent
 * blank, since the generator turns any valued column parameter into a filter.
 */
export function templatesUrl(query: { page?: number, perPage?: number, channel?: string } = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? TEMPLATES_PER_PAGE))))
  if (query.channel)
    params.set('channel', query.channel)
  params.set('sort', 'name')
  return `${TEMPLATES_ENDPOINT}?${params.toString()}`
}

/**
 * How many blocks a template's document holds.
 *
 * The column is JSON and arrives as a string from SQLite, but a driver that
 * parses JSON columns would hand over the object, so both are read. Anything
 * that is not a document with a `blocks` array counts as zero blocks rather
 * than throwing: a malformed row should not take the list down with it.
 */
export function blockCount(document: unknown): number {
  let parsed = document
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    }
    catch {
      return 0
    }
  }
  const blocks = (parsed as { blocks?: unknown } | null)?.blocks
  return Array.isArray(blocks) ? blocks.length : 0
}

/** A template as the table renders it. */
export interface TemplateView {
  id: number
  name: string
  channelLabel: string
  /** The subject line, or a placeholder when the template has none. */
  subject: string
  contentLabel: string
  revisionLabel: string
  updatedLabel: string
}

/** Normalize one API row into the shape the table renders. */
export function toTemplateView(row: TemplateRow, locale?: string): TemplateView {
  const blocks = blockCount(row.document)
  const revision = Math.max(1, Math.trunc(Number(row.revision) || 1))

  return {
    id: row.id,
    name: (row.name || '').trim() || `Template ${row.id}`,
    channelLabel: channelLabel(row.channel),
    subject: (row.subject || '').trim() || '-',
    contentLabel: blocks === 0 ? 'No blocks yet' : `${formatCount(blocks, locale)} ${blocks === 1 ? 'block' : 'blocks'}`,
    revisionLabel: `Revision ${formatCount(revision, locale)}`,
    updatedLabel: formatSeen(row.updated_at, locale),
  }
}

/** Normalize a whole response, tolerating a body that carries no rows. */
export function toTemplateViews(body: TemplateListResponse | null | undefined, locale?: string): TemplateView[] {
  return (body?.data ?? []).map(row => toTemplateView(row, locale))
}

/** What the create form holds. */
export interface TemplateDraft {
  name?: string
  channel?: string
  subject?: string
}

/** Why a draft cannot be saved, or an empty string when it can. */
export function draftError(draft: TemplateDraft): string {
  const name = (draft.name ?? '').trim()
  if (!name)
    return 'A template needs a name.'
  if (name.length > TEMPLATE_NAME_MAX)
    return `A template name can be at most ${TEMPLATE_NAME_MAX} characters.`
  if ((draft.subject ?? '').trim().length > TEMPLATE_SUBJECT_MAX)
    return `A subject line can be at most ${TEMPLATE_SUBJECT_MAX} characters.`
  return ''
}

/** The document a new template starts with: version one, no blocks. */
export const EMPTY_DOCUMENT = JSON.stringify({ version: 1, blocks: [] })

/**
 * The request body for a new template.
 *
 * `document` is required by the model, so a new template is sent the same
 * empty document the factory seeds. `revision` is absent: it is not fillable,
 * and the model defaults it to one. A subject is only kept for email, the one
 * channel that has a subject line; an unknown channel falls back to email.
 */
export function templatePayload(draft: TemplateDraft): { name: string, channel: string, subject: string | null, document: string } {
  const channel = TEMPLATE_CHANNELS.some(item => item.value === draft.channel) ? String(draft.channel) : 'email'
  const subject = (draft.subject ?? '').trim()
  return {
    name: (draft.name ?? '').trim(),
    channel,
    subject: channel === 'email' && subject ? subject : null,
    document: EMPTY_DOCUMENT,
  }
}

/** What to tell someone when the listing failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your templates.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no templates to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Templates could not be loaded because the API is not answering.'
  return `Templates could not be loaded (${status}).`
}

/** What to tell someone when the save failed. 409 is the (team_id, name) unique index. */
export function saveErrorMessage(status: number): string {
  if (status === 409)
    return 'This workspace already has a template with that name.'
  if (status === 422)
    return 'That template was rejected as invalid. Check the name and try again.'
  if (status === 401)
    return 'Your session has ended. Sign in again to save this template.'
  if (status === 403)
    return 'That request was refused. Reload the page and try again.'
  return `The template could not be saved (${status}).`
}
