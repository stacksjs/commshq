/**
 * Reading and writing publications through the application's own API.
 *
 * This page was the `publications` area of `WorkspaceSurface`: 148 published
 * posts, 2,184 paid members, 8,942 feed subscribers and a list of scheduled
 * issues. None of it was read from anywhere.
 *
 * `Publication`'s `useApi` trait publishes full CRUD at
 * `/api/v1/publications` behind `auth` and `team`, so this page lists,
 * creates and changes status.
 *
 * ## What a publication is here, and what the page does not show
 *
 * A publication is a named home that other records attach to: its members,
 * its podcasts and its referrals all point at one. That is what this page
 * manages. It does not publish anything, because there is nothing to
 * publish yet: the application has no post model, no editor for one and no
 * public route that serves a publication. So there are no posts, no feed
 * subscribers and no scheduled issues, and the status is a label on the
 * record, not a switch that puts something on the web. The page says so.
 *
 * No member count per publication either. The generated list returns no
 * relation counts, the same limit the forms page records.
 */
import { formatSeen } from './contacts-query'
import { slugFor } from './forms-query'

export const PUBLICATIONS_ENDPOINT = '/api/v1/publications'
export const PUBLICATIONS_PER_PAGE = 25

/** The limits and the slug shape the model's own validation declares. */
export const PUBLICATION_NAME_MIN = 2
export const PUBLICATION_NAME_MAX = 160
export const PUBLICATION_SLUG_MAX = 120
export const PUBLICATION_DESCRIPTION_MAX = 1000
const SLUG_PATTERN = /^[a-z0-9-]+$/

export const PUBLICATION_ACCESS = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
  { value: 'mixed', label: 'Free and paid' },
] as const

export const PUBLICATION_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
] as const

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function accessLabel(access?: string | null): string {
  const known = PUBLICATION_ACCESS.find(item => item.value === access)
  return known ? known.label : (access ? titleCase(String(access)) : 'Unknown')
}

export function statusLabel(status?: string | null): string {
  const known = PUBLICATION_STATUSES.find(item => item.value === status)
  return known ? known.label : (status ? titleCase(String(status)) : 'Unknown')
}

/** Build the listing URL: by name, then id, since two may share a name. */
export function publicationsUrl(query: { page?: number, perPage?: number, status?: string } = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? PUBLICATIONS_PER_PAGE))))
  if (query.status)
    params.set('status', query.status)
  params.set('sort', 'name,id')
  return `${PUBLICATIONS_ENDPOINT}?${params.toString()}`
}

export function publicationUrl(id: number): string {
  return `${PUBLICATIONS_ENDPOINT}/${Math.trunc(Number(id))}`
}

export interface PublicationRow {
  id: number
  name?: string | null
  slug?: string | null
  description?: string | null
  status?: string | null
  access?: string | null
  updated_at?: string | null
}

export interface PublicationView {
  id: number
  name: string
  slug: string
  description: string
  status: string
  statusLabel: string
  accessLabel: string
  updatedLabel: string
  /** The one forward step from this status, or '' when there is none. */
  nextStatus: string
  nextLabel: string
  canArchive: boolean
}

/**
 * The one forward step a status offers. A draft or a paused publication can
 * be made active, an active one paused, and an archived one brought back as
 * a draft, never straight to active.
 */
const NEXT: Record<string, { status: string, label: string }> = {
  draft: { status: 'active', label: 'Mark active' },
  paused: { status: 'active', label: 'Mark active' },
  active: { status: 'paused', label: 'Pause' },
  archived: { status: 'draft', label: 'Restore as draft' },
}

/** Normalize one API row into the shape the list renders. */
export function toPublicationView(row: PublicationRow, locale?: string): PublicationView {
  const status = String(row.status || 'draft')
  const next = NEXT[status]

  return {
    id: row.id,
    name: (row.name || '').trim() || `Publication ${row.id}`,
    slug: (row.slug || '').trim(),
    description: (row.description || '').replace(/\s+/g, ' ').trim(),
    status,
    statusLabel: statusLabel(status),
    accessLabel: accessLabel(row.access),
    updatedLabel: formatSeen(row.updated_at, locale),
    nextStatus: next ? next.status : '',
    nextLabel: next ? next.label : '',
    canArchive: status !== 'archived',
  }
}

export function toPublicationViews(body: { data?: PublicationRow[] } | null | undefined, locale?: string): PublicationView[] {
  return (body?.data ?? []).map(row => toPublicationView(row, locale))
}

/** What the create form holds. */
export interface PublicationDraft {
  name?: string
  slug?: string
  description?: string
  access?: string
}

/** Why a draft cannot be saved, against the limits the model declares. */
export function draftError(draft: PublicationDraft): string {
  const name = (draft.name ?? '').trim()
  const slug = (draft.slug ?? '').trim() || slugFor(name)
  const description = (draft.description ?? '').trim()
  if (name.length < PUBLICATION_NAME_MIN)
    return `A publication name needs at least ${PUBLICATION_NAME_MIN} characters.`
  if (name.length > PUBLICATION_NAME_MAX)
    return `A publication name can be at most ${PUBLICATION_NAME_MAX} characters.`
  if (slug.length < 2)
    return 'A publication needs a short name of at least 2 characters.'
  if (slug.length > PUBLICATION_SLUG_MAX)
    return `A short name can be at most ${PUBLICATION_SLUG_MAX} characters.`
  if (!SLUG_PATTERN.test(slug))
    return 'A short name can only use lowercase letters, digits and hyphens.'
  if (description.length > PUBLICATION_DESCRIPTION_MAX)
    return `A description can be at most ${PUBLICATION_DESCRIPTION_MAX} characters.`
  return ''
}

/**
 * The request body for a new publication. Always a draft; a blank
 * description is left out, since the column is nullable.
 */
export function publicationPayload(draft: PublicationDraft): { name: string, slug: string, access: string, status: 'draft', description?: string } {
  const name = (draft.name ?? '').trim()
  const payload: { name: string, slug: string, access: string, status: 'draft', description?: string } = {
    name,
    slug: (draft.slug ?? '').trim() || slugFor(name),
    access: PUBLICATION_ACCESS.some(item => item.value === draft.access) ? String(draft.access) : 'free',
    status: 'draft',
  }
  const description = (draft.description ?? '').trim()
  if (description)
    payload.description = description
  return payload
}

/** What to tell someone when the listing failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your publications.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no publications to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Publications could not be loaded because the API is not answering.'
  return `Publications could not be loaded (${status}).`
}

/** What to tell someone when a save failed. 409 is the (team_id, slug) unique index. */
export function saveErrorMessage(status: number): string {
  if (status === 409)
    return 'This workspace already has a publication with that short name.'
  if (status === 422)
    return 'That publication was rejected as invalid. Check the name and the short name.'
  if (status === 404)
    return 'That publication no longer exists. The list has been refreshed.'
  if (status === 401)
    return 'Your session has ended. Sign in again to save this publication.'
  if (status === 403)
    return 'That request was refused. Reload the page and try again.'
  return `The publication could not be saved (${status}).`
}
