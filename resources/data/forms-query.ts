/**
 * Reading and writing signup forms through the application's own API.
 *
 * The signup path behind this page was already real: `routes/public.ts`
 * accepts `POST /forms/{uuid}/submit`, and `SubscribeAction` finds an ACTIVE
 * form by its uuid, creates or finds the contact, records consent, joins the
 * form's audience and sends the confirmation when the form asks for double
 * opt-in. What was missing was any way to see or create a form from the
 * dashboard: the page was the `forms` area of `WorkspaceSurface`, stating
 * 38,412 views, a 42.8% completion rate and 4,906 confirmed signups.
 *
 * `FormDefinition`'s `useApi` trait publishes full CRUD at `/api/v1/forms`
 * behind `auth` and `team`, so this page lists, creates and changes status.
 *
 * ## What the page does not show
 *
 * No views and no completion rate: nothing records a view. No signup count
 * per form either. The generated list returns neither a total nor a
 * relation count (`with_count` is accepted and ignored for this model), so a
 * per-form number would mean one request per row or a count over a window
 * the page would have to explain. It is left out until an endpoint can
 * answer it in one piece.
 */
import { formatSeen } from './contacts-query'
import { formatCount } from './workspace-summary'

export const FORMS_ENDPOINT = '/api/v1/forms'
export const FORMS_PER_PAGE = 25

/** The limits and the slug shape the model's own validation declares. */
export const FORM_NAME_MIN = 2
export const FORM_NAME_MAX = 160
export const FORM_SLUG_MAX = 120
const SLUG_PATTERN = /^[a-z0-9-]+$/

export const FORM_KINDS = [
  { value: 'inline', label: 'Inline form' },
  { value: 'popup', label: 'Popup' },
  { value: 'landing_page', label: 'Landing page' },
  { value: 'gated_resource', label: 'Gated resource' },
] as const

export const FORM_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
] as const

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function kindLabel(kind?: string | null): string {
  const known = FORM_KINDS.find(item => item.value === kind)
  return known ? known.label : (kind ? titleCase(String(kind)) : 'Unknown')
}

export function statusLabel(status?: string | null): string {
  const known = FORM_STATUSES.find(item => item.value === status)
  return known ? known.label : (status ? titleCase(String(status)) : 'Unknown')
}

/**
 * Build the listing URL.
 *
 * Sorted by name, then id. The unique index is on the slug, not the name, so
 * two forms may share a name and the id is what keeps a row on one page.
 */
export function formsUrl(query: { page?: number, perPage?: number, status?: string } = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? FORMS_PER_PAGE))))
  if (query.status)
    params.set('status', query.status)
  params.set('sort', 'name,id')
  return `${FORMS_ENDPOINT}?${params.toString()}`
}

export function formUrl(id: number): string {
  return `${FORMS_ENDPOINT}/${Math.trunc(Number(id))}`
}

/**
 * Where a site posts a signup for this form.
 *
 * Keyed by the uuid, which is what `SubscribeAction` looks a form up by. The
 * numeric id is never used in a public address: it is sequential, and a form
 * address that can be guessed by counting is an invitation to try the next.
 */
export function submitPath(uuid?: string | null): string {
  const key = String(uuid ?? '').trim()
  return key ? `/forms/${key}/submit` : ''
}

/**
 * A slug from a name: lowercase letters, digits and single hyphens.
 *
 * The same shape the model validates (`^[a-z0-9-]+$`, at most 120), so a
 * suggested slug is always one the endpoint would accept.
 */
export function slugFor(name?: string | null): string {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FORM_SLUG_MAX)
    .replace(/-+$/g, '')
}

interface ParsedDocument {
  fieldCount: number
  allowedOrigins: number
}

/**
 * The two facts the list shows from a form's `schema_document`.
 *
 * A small reader of its own rather than an import of
 * `app/Support/formSettings`, which belongs to the server; a test holds the
 * origin count here to what that parser accepts, so the two cannot disagree
 * about which sites a form allows.
 */
export function readDocument(schemaDocument: unknown): ParsedDocument {
  let doc: unknown = schemaDocument
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc)
    }
    catch {
      doc = null
    }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    return { fieldCount: 0, allowedOrigins: 0 }

  const record = doc as { fields?: unknown, allowedOrigins?: unknown }
  const origins = new Set<string>()
  for (const value of Array.isArray(record.allowedOrigins) ? record.allowedOrigins : []) {
    if (typeof value !== 'string' || !value.trim())
      continue
    try {
      const url = new URL(value.trim())
      if (url.protocol === 'https:' || url.protocol === 'http:')
        origins.add(url.origin)
    }
    catch {}
  }

  return {
    fieldCount: Array.isArray(record.fields) ? record.fields.length : 0,
    allowedOrigins: origins.size,
  }
}

export interface FormRow {
  id: number
  uuid?: string | null
  name?: string | null
  slug?: string | null
  kind?: string | null
  schema_document?: unknown
  double_opt_in?: boolean | number | null
  status?: string | null
  updated_at?: string | null
}

export interface FormView {
  id: number
  name: string
  slug: string
  kindLabel: string
  status: string
  statusLabel: string
  optInLabel: string
  fieldsLabel: string
  originsLabel: string
  /** The public address, shown only while the form accepts signups. */
  submitPath: string
  updatedLabel: string
}

/** Normalize one API row into the shape the list renders. */
export function toFormView(row: FormRow, locale?: string): FormView {
  const status = String(row.status || 'draft')
  const doc = readDocument(row.schema_document)
  const doubleOptIn = row.double_opt_in === true || row.double_opt_in === 1

  return {
    id: row.id,
    name: (row.name || '').trim() || `Form ${row.id}`,
    slug: (row.slug || '').trim(),
    kindLabel: kindLabel(row.kind),
    status,
    statusLabel: statusLabel(status),
    optInLabel: doubleOptIn ? 'Double opt-in' : 'Single opt-in',
    fieldsLabel: `${formatCount(doc.fieldCount, locale)} ${doc.fieldCount === 1 ? 'field' : 'fields'}`,
    // Empty means any site, which is how SubscribeAction reads it too.
    originsLabel: doc.allowedOrigins === 0 ? 'Any site may post to it' : `${formatCount(doc.allowedOrigins, locale)} allowed ${doc.allowedOrigins === 1 ? 'site' : 'sites'}`,
    // Only an active form answers. Showing the address of a draft would
    // hand someone a URL that returns "not found" and looks like a bug.
    submitPath: status === 'active' ? submitPath(row.uuid) : '',
    updatedLabel: formatSeen(row.updated_at, locale),
  }
}

export function toFormViews(body: { data?: FormRow[] } | null | undefined, locale?: string): FormView[] {
  return (body?.data ?? []).map(row => toFormView(row, locale))
}

/** What the create form holds. */
export interface FormDraft {
  name?: string
  slug?: string
  kind?: string
  doubleOptIn?: boolean
}

/** Why a draft cannot be saved, against the limits the model declares. */
export function draftError(draft: FormDraft): string {
  const name = (draft.name ?? '').trim()
  const slug = (draft.slug ?? '').trim() || slugFor(name)
  if (name.length < FORM_NAME_MIN)
    return `A form name needs at least ${FORM_NAME_MIN} characters.`
  if (name.length > FORM_NAME_MAX)
    return `A form name can be at most ${FORM_NAME_MAX} characters.`
  if (slug.length < 2)
    return 'A form needs an address of at least 2 characters.'
  if (slug.length > FORM_SLUG_MAX)
    return `A form address can be at most ${FORM_SLUG_MAX} characters.`
  if (!SLUG_PATTERN.test(slug))
    return 'A form address can only use lowercase letters, digits and hyphens.'
  return ''
}

/** The document a new form starts with: one required email field, nothing else. */
export const STARTER_DOCUMENT = JSON.stringify({ fields: [{ name: 'email', type: 'email', required: true }] })

/**
 * The request body for a new form.
 *
 * Always a draft. A form that accepted signups the instant it was created
 * would be live on the public endpoint before anyone had looked at it;
 * activating is a separate, deliberate step on the list. Double opt-in is on
 * unless it was explicitly turned off, matching the model's own default.
 */
export function formPayload(draft: FormDraft): { name: string, slug: string, kind: string, schema_document: string, double_opt_in: boolean, status: 'draft' } {
  const name = (draft.name ?? '').trim()
  return {
    name,
    slug: (draft.slug ?? '').trim() || slugFor(name),
    kind: FORM_KINDS.some(item => item.value === draft.kind) ? String(draft.kind) : 'inline',
    schema_document: STARTER_DOCUMENT,
    double_opt_in: draft.doubleOptIn !== false,
    status: 'draft',
  }
}

/** What to tell someone when the listing failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your forms.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no forms to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Forms could not be loaded because the API is not answering.'
  return `Forms could not be loaded (${status}).`
}

/** What to tell someone when a save failed. 409 is the (team_id, slug) unique index. */
export function saveErrorMessage(status: number): string {
  if (status === 409)
    return 'This workspace already has a form at that address.'
  if (status === 422)
    return 'That form was rejected as invalid. Check the name and the address.'
  if (status === 404)
    return 'That form no longer exists. The list has been refreshed.'
  if (status === 401)
    return 'Your session has ended. Sign in again to save this form.'
  if (status === 403)
    return 'That request was refused. Reload the page and try again.'
  return `The form could not be saved (${status}).`
}
