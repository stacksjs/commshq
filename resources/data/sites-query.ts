/**
 * Reading and writing a workspace's pages through the application's own API.
 *
 * This page was the `sites` area of `WorkspaceSurface`: 3 live sites, 2
 * custom domains, 100% TLS coverage, 99.9% redirect health and a
 * certificate with 42 days left. None of it was read from anywhere, and
 * none of it could have been: the application serves no site, attaches no
 * domain and issues no certificate.
 *
 * What it does have is two kinds of page a site would hold, each with full
 * CRUD from its model's `useApi` trait, behind `auth` and `team`:
 *
 * - link pages at `/api/v1/link-pages`: a title, a short bio and a list of
 *   links
 * - landing pages at `/api/v1/landing-pages`: a name and what a search
 *   result would show for it
 *
 * So this page lists them, creates them as drafts, and archives or restores
 * them.
 *
 * ## What the page does not do
 *
 * It does not publish. Both models accept `published` as a status, but no
 * route serves a page, so setting it would put nothing on the web while the
 * record claimed otherwise. The page only ever writes `draft` and
 * `archived`, and says why. A row that is already `published` (written by
 * some other client) is shown as it is and can be archived.
 *
 * No sites, domains, certificates or redirects, for the reason above. No
 * editor for a landing page's blocks either: it is saved with none.
 *
 * ## Short names
 *
 * The unique index on both tables is (team, site, short name). A page
 * created here belongs to no site, and a database treats two missing sites
 * as different, so the index does not stop two pages sharing a short name.
 * The page asks the API whether the short name is taken before it saves.
 * That is a courtesy, not a guarantee: two people saving at once can still
 * both get through.
 */
import { formatSeen } from './contacts-query'
import { slugFor } from './forms-query'
import { safeWebsite } from './monetization-query'

export const PAGE_KINDS = [
  { key: 'link', label: 'Link pages', singular: 'link page', endpoint: '/api/v1/link-pages', nameField: 'title', nameLabel: 'Title' },
  { key: 'landing', label: 'Landing pages', singular: 'landing page', endpoint: '/api/v1/landing-pages', nameField: 'name', nameLabel: 'Name' },
] as const

export type PageKind = typeof PAGE_KINDS[number]['key']

export const PAGES_PER_PAGE = 25

/** The limits the models' own validation declares. */
export const PAGE_NAME_MAX = 160
export const PAGE_SLUG_MAX = 160
export const LINK_BIO_MAX = 500
/** The page's own limits: the models only require valid JSON. */
export const LINKS_MAX = 20
export const LINK_LABEL_MAX = 80
export const SEO_TITLE_MAX = 70
export const SEO_DESCRIPTION_MAX = 160
const SLUG_PATTERN = /^[a-z0-9-]+$/

/** Every status each model accepts, for the filter. */
export const PAGE_STATUSES: Record<PageKind, ReadonlyArray<{ value: string, label: string }>> = {
  link: [
    { value: 'draft', label: 'Draft' },
    { value: 'published', label: 'Published' },
    { value: 'archived', label: 'Archived' },
  ],
  landing: [
    { value: 'draft', label: 'Draft' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'published', label: 'Published' },
    { value: 'archived', label: 'Archived' },
  ],
}

/** The only statuses this page writes. See "What the page does not do". */
export const SETTABLE_STATUSES = ['draft', 'archived'] as const

export const NOT_SERVED = 'Nothing here is on the web. CommsHQ does not serve these pages, attach domains or issue certificates yet, so a page is saved as a draft and cannot be published from here.'

export function kindOf(key?: string | null) {
  return PAGE_KINDS.find(kind => kind.key === key) ?? PAGE_KINDS[0]
}

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function statusLabel(kind: PageKind, status?: string | null): string {
  const known = PAGE_STATUSES[kind].find(item => item.value === status)
  return known ? known.label : (status ? titleCase(String(status)) : 'Unknown')
}

/** Build the listing URL: by name, then id, since two may share a name. */
export function pagesUrl(kind: PageKind, query: { page?: number, perPage?: number, status?: string } = {}): string {
  const config = kindOf(kind)
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? PAGES_PER_PAGE))))
  if (query.status)
    params.set('status', query.status)
  params.set('sort', `${config.nameField},id`)
  return `${config.endpoint}?${params.toString()}`
}

export function pageUrl(kind: PageKind, id: number): string {
  return `${kindOf(kind).endpoint}/${Math.trunc(Number(id))}`
}

/** Ask whether a page of this kind already uses the short name. */
export function slugCheckUrl(kind: PageKind, slug: string): string {
  const params = new URLSearchParams({ slug, per_page: '1' })
  return `${kindOf(kind).endpoint}?${params.toString()}`
}

export function slugTaken(body: { data?: unknown[] } | null | undefined): boolean {
  return Array.isArray(body?.data) && body.data.length > 0
}

export interface PageLink {
  label: string
  url: string
  host: string
}

/**
 * The links a link page holds, as safe links.
 *
 * The column is JSON typed by a member and shown to every other member, so
 * it is read defensively: anything that is not a list is no links, and an
 * entry whose address is not plain http or https is dropped rather than
 * rendered as an href.
 */
export function storedLinks(value: unknown): PageLink[] {
  let list: unknown = value
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value)
    }
    catch {
      return []
    }
  }
  if (!Array.isArray(list))
    return []
  const links: PageLink[] = []
  for (const entry of list) {
    const url = safeWebsite((entry as { url?: unknown } | null)?.url as string | undefined)
    if (!url)
      continue
    const host = new URL(url).host
    const label = String((entry as { label?: unknown }).label ?? '').replace(/\s+/g, ' ').trim()
    links.push({ label: label || host, url, host })
  }
  return links
}

function storedSeo(value: unknown): { title: string, description: string } {
  let seo: unknown = value
  if (typeof value === 'string') {
    try {
      seo = JSON.parse(value)
    }
    catch {
      seo = null
    }
  }
  const record = seo && typeof seo === 'object' && !Array.isArray(seo) ? seo as Record<string, unknown> : {}
  const text = (item: unknown) => (typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : '')
  return { title: text(record.title), description: text(record.description) }
}

export interface PageRow {
  id: number
  title?: string | null
  name?: string | null
  slug?: string | null
  bio?: string | null
  links?: unknown
  seo?: unknown
  status?: string | null
  updated_at?: string | null
}

export interface PageView {
  id: number
  name: string
  slug: string
  status: string
  statusLabel: string
  updatedLabel: string
  /** A link page's bio, or a landing page's search description. */
  detail: string
  /** A landing page's search title, when it differs from the name. */
  searchTitle: string
  links: PageLink[]
  linkSummary: string
  /** The one status this page can be moved to from here, or ''. */
  nextStatus: string
  nextLabel: string
}

/** Normalize one API row into the shape the list renders. */
export function toPageView(kind: PageKind, row: PageRow, locale?: string): PageView {
  const status = String(row.status || 'draft')
  const name = String((kind === 'link' ? row.title : row.name) ?? '').trim() || `${titleCase(kindOf(kind).singular)} ${row.id}`
  const links = kind === 'link' ? storedLinks(row.links) : []
  const seo = kind === 'landing' ? storedSeo(row.seo) : { title: '', description: '' }
  const archived = status === 'archived'

  return {
    id: row.id,
    name,
    slug: (row.slug || '').trim(),
    status,
    statusLabel: statusLabel(kind, status),
    updatedLabel: formatSeen(row.updated_at, locale),
    detail: kind === 'link' ? String(row.bio ?? '').replace(/\s+/g, ' ').trim() : seo.description,
    searchTitle: seo.title && seo.title !== name ? seo.title : '',
    links,
    linkSummary: kind === 'link' ? (links.length === 1 ? '1 link' : `${links.length} links`) : '',
    // Whatever the status, the only way out of archived is back to a draft.
    nextStatus: archived ? 'draft' : 'archived',
    nextLabel: archived ? 'Restore as draft' : 'Archive',
  }
}

export function toPageViews(kind: PageKind, body: { data?: PageRow[] } | null | undefined, locale?: string): PageView[] {
  return (body?.data ?? []).map(row => toPageView(kind, row, locale))
}

/**
 * Read the links box: one link per line, as `Label | https://address`, or
 * just the address. Blank lines are skipped. The first line that cannot be
 * a link is reported by its number, and nothing is saved.
 */
export function parseLinks(text?: string | null): { links: Array<{ label: string, url: string }>, error: string } {
  const links: Array<{ label: string, url: string }> = []
  const lines = String(text ?? '').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (!line)
      continue
    const bar = line.lastIndexOf('|')
    const address = (bar === -1 ? line : line.slice(bar + 1)).trim()
    const url = safeWebsite(address)
    if (!url)
      return { links: [], error: `Line ${index + 1} needs a web address that starts with https:// or http://.` }
    const label = (bar === -1 ? '' : line.slice(0, bar)).replace(/\s+/g, ' ').trim() || new URL(url).host
    if (label.length > LINK_LABEL_MAX)
      return { links: [], error: `The label on line ${index + 1} can be at most ${LINK_LABEL_MAX} characters.` }
    links.push({ label, url })
  }
  if (links.length > LINKS_MAX)
    return { links: [], error: `A link page can hold at most ${LINKS_MAX} links.` }
  return { links, error: '' }
}

/** What the create form holds. Which fields count depends on the kind. */
export interface PageDraft {
  name?: string
  slug?: string
  bio?: string
  links?: string
  seoTitle?: string
  seoDescription?: string
}

function draftSlug(draft: PageDraft): string {
  return (draft.slug ?? '').trim() || slugFor((draft.name ?? '').trim()).slice(0, PAGE_SLUG_MAX).replace(/-+$/g, '')
}

/** Why a draft cannot be saved. */
export function draftError(kind: PageKind, draft: PageDraft): string {
  const config = kindOf(kind)
  const name = (draft.name ?? '').trim()
  const slug = draftSlug(draft)
  if (name.length < 2)
    return `A ${config.singular} needs a ${config.nameLabel.toLowerCase()} of at least 2 characters.`
  if (name.length > PAGE_NAME_MAX)
    return `A ${config.nameLabel.toLowerCase()} can be at most ${PAGE_NAME_MAX} characters.`
  if (slug.length < 2)
    return `A ${config.singular} needs a short name of at least 2 characters.`
  if (slug.length > PAGE_SLUG_MAX)
    return `A short name can be at most ${PAGE_SLUG_MAX} characters.`
  if (!SLUG_PATTERN.test(slug))
    return 'A short name can only use lowercase letters, digits and hyphens.'

  if (kind === 'link') {
    if ((draft.bio ?? '').trim().length > LINK_BIO_MAX)
      return `A bio can be at most ${LINK_BIO_MAX} characters.`
    return parseLinks(draft.links).error
  }

  if ((draft.seoTitle ?? '').trim().length > SEO_TITLE_MAX)
    return `A search title can be at most ${SEO_TITLE_MAX} characters.`
  if ((draft.seoDescription ?? '').trim().length > SEO_DESCRIPTION_MAX)
    return `A search description can be at most ${SEO_DESCRIPTION_MAX} characters.`
  return ''
}

/**
 * The request body for a new page. Always a draft. The JSON columns go as
 * strings, which is what the generated API validates.
 */
export function pagePayload(kind: PageKind, draft: PageDraft): Record<string, string> {
  const name = (draft.name ?? '').trim()
  const slug = draftSlug(draft)

  if (kind === 'link') {
    const payload: Record<string, string> = {
      title: name,
      slug,
      links: JSON.stringify(parseLinks(draft.links).links),
      theme: JSON.stringify({ style: 'editorial' }),
      status: 'draft',
    }
    const bio = (draft.bio ?? '').trim()
    if (bio)
      payload.bio = bio
    return payload
  }

  const seo: Record<string, string> = {}
  const seoTitle = (draft.seoTitle ?? '').trim()
  const seoDescription = (draft.seoDescription ?? '').trim()
  if (seoTitle)
    seo.title = seoTitle
  if (seoDescription)
    seo.description = seoDescription
  return {
    name,
    slug,
    document: JSON.stringify({ blocks: [] }),
    seo: JSON.stringify(seo),
    status: 'draft',
  }
}

/** The body of a status change, or null when this page does not write that status. */
export function statusPayload(next: string): { status: string } | null {
  return (SETTABLE_STATUSES as readonly string[]).includes(next) ? { status: next } : null
}

/** What to tell someone when the listing failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your pages.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no pages to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Pages could not be loaded because the API is not answering.'
  return `Pages could not be loaded (${status}).`
}

/** What to tell someone when a save failed. */
export function saveErrorMessage(status: number): string {
  if (status === 409)
    return 'This workspace already has a page of this kind with that short name.'
  if (status === 422)
    return 'That page was rejected as invalid. Check the name and the short name.'
  if (status === 404)
    return 'That page no longer exists. The list has been refreshed.'
  if (status === 401)
    return 'Your session has ended. Sign in again to save this page.'
  if (status === 403)
    return 'That request was refused. Reload the page and try again.'
  return `The page could not be saved (${status}).`
}
