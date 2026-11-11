/**
 * Reading and writing segments through the application's own API.
 *
 * `Segment` declares `useApi: { prefix: 'v1', uri: 'segments', middleware:
 * ['auth', 'team'] }`, so `/api/v1/segments` already exists, is scoped to the
 * caller's team by the model's `belongsTo: ['Team']`, and paginates. Nothing
 * here is a new endpoint. It is the same arrangement as `contacts-query.ts`,
 * for the same reasons: the request and the row formatting can be tested
 * without a browser, and the page stays markup plus state.
 *
 * ## What a segment can honestly say about itself
 *
 * A segment row carries `estimated_count` and `refreshed_at`. Nothing in this
 * application evaluates a segment yet: there is no evaluator, and a workspace
 * holds no rules or snapshots until somebody writes them. So the size column
 * is only a fact when `refreshed_at` says an evaluation happened, and this
 * module prints the count only then. A never-refreshed segment reads "Not
 * evaluated yet", whatever number its row happens to hold.
 *
 * There is no search here, on purpose. The generator searches the model's
 * `useSearch.searchable` fields and `Segment` declares none, so a search box
 * would send a parameter the endpoint ignores and return every row for every
 * query, which reads as a broken filter rather than a missing one.
 */
import { formatSeen } from './contacts-query'
import { formatCount } from './workspace-summary'

/** A segment exactly as the generated endpoint returns it: snake_case columns. */
export interface SegmentRow {
  id: number
  name?: string | null
  description?: string | null
  match_type?: string | null
  estimated_count?: number | null
  refreshed_at?: string | null
  created_at?: string | null
}

export interface SegmentListResponse {
  data?: SegmentRow[]
  has_more_pages?: boolean
  total?: number
}

export const SEGMENTS_ENDPOINT = '/api/v1/segments'

export const SEGMENTS_PER_PAGE = 25

/** The longest name the model's own validation accepts. */
export const SEGMENT_NAME_MAX = 120

/** The longest description the model's own validation accepts. */
export const SEGMENT_DESCRIPTION_MAX = 500

/**
 * How a segment combines its rules, as the model's enum declares it, with the
 * words a person choosing between them should see.
 */
export const SEGMENT_MATCH_TYPES = [
  { value: 'all', label: 'Every rule' },
  { value: 'any', label: 'Any rule' },
] as const

/** The words for a match type, falling back to the raw value rather than hiding it. */
export function matchLabel(matchType?: string | null): string {
  const known = SEGMENT_MATCH_TYPES.find(item => item.value === matchType)
  return known ? known.label : (matchType || 'Unknown')
}

/**
 * Build the listing URL.
 *
 * Sorted by name. `segments_team_name_unique` makes the name unique within a
 * workspace, so it is a total order and a row cannot appear on two pages. The
 * creation time is not: rows written in one seed run or one import share a
 * timestamp, which is the tie the contacts page had to be rescued from.
 */
export function segmentsUrl(query: { page?: number, perPage?: number } = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? SEGMENTS_PER_PAGE))))
  params.set('sort', 'name')
  return `${SEGMENTS_ENDPOINT}?${params.toString()}`
}

/** A segment as the table renders it. */
export interface SegmentView {
  id: number
  name: string
  description: string
  matchLabel: string
  /** Whether an evaluation has ever been recorded for this segment. */
  evaluated: boolean
  /** The size, or a statement that there is not one yet. */
  sizeLabel: string
  refreshedLabel: string
}

export const NOT_EVALUATED = 'Not evaluated yet'

/** Normalize one API row into the shape the table renders. */
export function toSegmentView(row: SegmentRow, locale?: string): SegmentView {
  const refreshed = Date.parse(String(row.refreshed_at ?? ''))
  const evaluated = Number.isFinite(refreshed)

  return {
    id: row.id,
    name: (row.name || '').trim() || `Segment ${row.id}`,
    description: (row.description || '').trim(),
    matchLabel: matchLabel(row.match_type),
    evaluated,
    sizeLabel: evaluated ? formatCount(row.estimated_count, locale) : NOT_EVALUATED,
    refreshedLabel: formatSeen(row.refreshed_at, locale),
  }
}

/** Normalize a whole response, tolerating a body that carries no rows. */
export function toSegmentViews(body: SegmentListResponse | null | undefined, locale?: string): SegmentView[] {
  return (body?.data ?? []).map(row => toSegmentView(row, locale))
}

/** What the create form holds. */
export interface SegmentDraft {
  name?: string
  description?: string
  matchType?: string
}

/**
 * Why a draft cannot be saved, or an empty string when it can.
 *
 * Checked here as well as by the endpoint so the form can answer before a
 * round trip, against the same limits the model declares.
 */
export function draftError(draft: SegmentDraft): string {
  const name = (draft.name ?? '').trim()
  if (!name)
    return 'A segment needs a name.'
  if (name.length > SEGMENT_NAME_MAX)
    return `A segment name can be at most ${SEGMENT_NAME_MAX} characters.`
  if ((draft.description ?? '').trim().length > SEGMENT_DESCRIPTION_MAX)
    return `A description can be at most ${SEGMENT_DESCRIPTION_MAX} characters.`
  return ''
}

/**
 * The request body for a new segment.
 *
 * `estimated_count` and `refreshed_at` are deliberately absent. The first is
 * not fillable on the model, and neither is a thing the person creating a
 * segment knows: a size is the result of an evaluation, not an input to one.
 * An unknown match type falls back to `all`, the model's own default.
 */
export function segmentPayload(draft: SegmentDraft): { name: string, description: string | null, match_type: string } {
  const matchType = SEGMENT_MATCH_TYPES.some(item => item.value === draft.matchType) ? String(draft.matchType) : 'all'
  return {
    name: (draft.name ?? '').trim(),
    description: (draft.description ?? '').trim() || null,
    match_type: matchType,
  }
}

/** What to tell someone when the listing failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your segments.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no segments to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Segments could not be loaded because the API is not answering.'
  return `Segments could not be loaded (${status}).`
}

/**
 * What to tell someone when the save failed.
 *
 * 409 is the auto-CRUD layer's unique-constraint answer, and `segments`
 * carries a unique index on (team_id, name), so that one can be named exactly.
 */
export function saveErrorMessage(status: number): string {
  if (status === 409)
    return 'This workspace already has a segment with that name.'
  if (status === 422)
    return 'That segment was rejected as invalid. Check the name and try again.'
  if (status === 401)
    return 'Your session has ended. Sign in again to save this segment.'
  if (status === 403)
    return 'That request was refused. Reload the page and try again.'
  return `The segment could not be saved (${status}).`
}
