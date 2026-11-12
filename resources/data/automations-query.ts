/**
 * Reading and drafting automations through the application's own API.
 *
 * This page was a static builder: a "First purchase welcome" journey at
 * version 6, a five-node canvas with a YES/NO branch, a step palette and a
 * "Ready to test" panel. None of it was read from anywhere, and none of the
 * buttons did anything.
 *
 * `Automation` is the framework's model. `config/security.ts` names it, which
 * publishes its CRUD at `/api/automations` behind `auth` and `team`.
 *
 * ## What exists behind it, and what does not
 *
 * The table, and a job: `ProcessAutomationRun` walks the nodes of a published
 * version for one run, parks on `approval` and `delay` nodes, and marks every
 * other node completed. Three things it would need are not there yet:
 *
 * - nothing starts a run. No code reads an automation's `trigger`, so no
 *   event creates an `automation_runs` row;
 * - nothing publishes a version. The job reads `automation_versions`, and
 *   that model has no create route and no writer;
 * - a message step sends nothing. The job records it as accepted and moves on.
 *
 * So this page lists automations, saves new ones as drafts and archives them,
 * and stops there. It offers no way to switch one on, because an "active"
 * automation would look live and do nothing. That is said on the page in
 * plain words rather than left for someone to find out.
 *
 * No step editor either: with no way to publish or run a graph, a canvas
 * would be the old mock with a save button.
 */
import { formatSeen } from './contacts-query'
import { formatCount } from './workspace-summary'

export const AUTOMATIONS_ENDPOINT = '/api/automations'
export const AUTOMATIONS_PER_PAGE = 25

/** The limit the model's own validation declares. The floor is this page's. */
export const AUTOMATION_NAME_MIN = 3
export const AUTOMATION_NAME_MAX = 255

export const AUTOMATION_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
] as const

/**
 * The trigger a new draft is saved with: the one the model's own factory
 * uses. Nothing reads a trigger yet, so offering a choice of several would be
 * offering names this page made up.
 */
export const DEFAULT_TRIGGER_TYPE = 'subscriber_joined'

const TRIGGER_LABELS: Record<string, string> = {
  subscriber_joined: 'When a subscriber joins',
}

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function statusLabel(status?: string | null): string {
  const known = AUTOMATION_STATUSES.find(item => item.value === status)
  return known ? known.label : (status ? titleCase(String(status)) : 'Unknown')
}

function parseDocument(value: unknown): unknown {
  if (typeof value !== 'string')
    return value
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}

/** A trigger in words, from the `trigger` document's `type`. */
export function triggerLabel(trigger: unknown): string {
  const doc = parseDocument(trigger) as { type?: unknown } | null
  const type = doc && typeof doc === 'object' && typeof doc.type === 'string' ? doc.type.trim() : ''
  if (!type)
    return 'No trigger set'
  return TRIGGER_LABELS[type] ?? `On ${titleCase(type).toLowerCase()}`
}

/**
 * How many steps a graph holds.
 *
 * Counted the way `automationNodes` in `app/Support/automationFlow.ts` reads
 * them, since those are the nodes the job would walk: an entry counts only
 * with a string or number `id` and a string `type`. A test holds the two
 * together.
 */
export function stepCount(graph: unknown): number {
  const doc = parseDocument(graph) as { nodes?: unknown } | null
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes))
    return 0
  return doc.nodes.filter((node: unknown) => {
    return !!node && typeof node === 'object'
      && ['string', 'number'].includes(typeof (node as { id?: unknown }).id)
      && typeof (node as { type?: unknown }).type === 'string'
  }).length
}

/** Build the listing URL: by name, then id, since names are not unique. */
export function automationsUrl(query: { page?: number, perPage?: number, status?: string } = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? AUTOMATIONS_PER_PAGE))))
  if (query.status)
    params.set('status', query.status)
  params.set('sort', 'name,id')
  return `${AUTOMATIONS_ENDPOINT}?${params.toString()}`
}

export function automationUrl(id: number): string {
  return `${AUTOMATIONS_ENDPOINT}/${Math.trunc(Number(id))}`
}

export interface AutomationRow {
  id: number
  name?: string | null
  status?: string | null
  version?: number | null
  trigger?: unknown
  graph?: unknown
  published_at?: string | null
  updated_at?: string | null
}

export interface AutomationView {
  id: number
  name: string
  status: string
  statusLabel: string
  triggerLabel: string
  stepsLabel: string
  publishedLabel: string
  updatedLabel: string
  /** A row that is `active` or `paused` got there some other way; it can be stood down. */
  canPause: boolean
  canArchive: boolean
  canRestore: boolean
}

/** Normalize one API row into the shape the list renders. */
export function toAutomationView(row: AutomationRow, locale?: string): AutomationView {
  const status = String(row.status || 'draft')
  const steps = stepCount(row.graph)

  return {
    id: row.id,
    name: (row.name || '').trim() || `Automation ${row.id}`,
    status,
    statusLabel: statusLabel(status),
    triggerLabel: triggerLabel(row.trigger),
    stepsLabel: steps === 0 ? 'No steps yet' : `${formatCount(steps, locale)} ${steps === 1 ? 'step' : 'steps'}`,
    publishedLabel: row.published_at ? `Published ${formatSeen(row.published_at, locale)}` : 'Never published',
    updatedLabel: formatSeen(row.updated_at, locale),
    canPause: status === 'active',
    canArchive: status !== 'archived',
    canRestore: status === 'archived',
  }
}

export function toAutomationViews(body: { data?: AutomationRow[] } | null | undefined, locale?: string): AutomationView[] {
  return (body?.data ?? []).map(row => toAutomationView(row, locale))
}

/** Why a draft cannot be saved. */
export function draftError(draft: { name?: string }): string {
  const name = (draft.name ?? '').trim()
  if (name.length < AUTOMATION_NAME_MIN)
    return `An automation name needs at least ${AUTOMATION_NAME_MIN} characters.`
  if (name.length > AUTOMATION_NAME_MAX)
    return `An automation name can be at most ${AUTOMATION_NAME_MAX} characters.`
  return ''
}

/** The graph a new automation starts with: the model factory's empty one. */
export const EMPTY_GRAPH = JSON.stringify({ nodes: [], edges: [] })

/**
 * The request body for a new automation.
 *
 * Always a draft at version 1, with the default trigger and an empty graph.
 * `trigger` and `graph` are required by the model, so they are always sent.
 */
export function automationPayload(draft: { name?: string }): { name: string, status: 'draft', version: 1, trigger: string, graph: string } {
  return {
    name: (draft.name ?? '').trim(),
    status: 'draft',
    version: 1,
    trigger: JSON.stringify({ type: DEFAULT_TRIGGER_TYPE }),
    graph: EMPTY_GRAPH,
  }
}

/**
 * The statuses this page may set. Never `active`: nothing would run, and the
 * row would say otherwise.
 */
export const SETTABLE_STATUSES = ['draft', 'paused', 'archived'] as const

export function statusPayload(next: string): { status: string } | null {
  return (SETTABLE_STATUSES as readonly string[]).includes(next) ? { status: next } : null
}

/** What to tell someone when the listing failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your automations.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no automations to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Automations could not be loaded because the API is not answering.'
  return `Automations could not be loaded (${status}).`
}

/** What to tell someone when a save or a status change failed. */
export function saveErrorMessage(status: number): string {
  if (status === 422)
    return 'That automation was rejected as invalid. Check the name.'
  if (status === 404)
    return 'That automation no longer exists. The list has been refreshed.'
  if (status === 401)
    return 'Your session has ended. Sign in again to save this automation.'
  if (status === 403)
    return 'That request was refused. Reload the page and try again.'
  return `The automation could not be saved (${status}).`
}
