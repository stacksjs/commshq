/**
 * Automations through the application's own API: drafting them, editing
 * their steps, turning them on, and seeing what they have done.
 *
 * This page was a static builder: a "First purchase welcome" journey at
 * version 6, a five-node canvas and a "Ready to test" panel, none of it read
 * from anywhere. Later it could list and draft automations but not run
 * them, because nothing started a run, nothing published a version, and the
 * run job marked email steps "accepted" without sending them.
 *
 * ## How an automation runs now
 *
 * - **Trigger.** Chosen when the automation is drafted. `subscriber_joined`:
 *   someone confirms an email subscription through a signup form (or signs
 *   up on a form without double opt-in). `purchase_made`: a connected store
 *   sends an order from an email address that is already a contact.
 *   `cart_abandoned`: a contact's Shopify cart goes an hour without an
 *   order. Each active automation starts once per contact, ever, or for a
 *   cart once per cart, and a cart run stops when the cart is bought. A contact added on the
 *   Contacts page starts nothing.
 * - **Steps.** Send an email from the automation's sender, send a text
 *   through the deployment's SMS provider, or wait between 1 hour and 30
 *   days. A text goes only to a contact with a phone number and SMS
 *   consent, and is held through quiet hours; without them that one text
 *   is skipped. A saved step of any other kind blocks turning on until it
 *   is removed.
 * - **Turning on.** `POST /api/v1/automations/{id}/publish`, an admin or
 *   owner only, checks the steps and the sender and freezes them, with the
 *   trigger, as a version. A run keeps the version it started on. Saving
 *   steps or the trigger changes the draft; the live version changes when
 *   it is turned on again. The page can also ask it to include the people
 *   who already meet the trigger, after saying how many there are.
 * - **Sending.** Each email checks consent and the sender's verified
 *   domain first, carries an unsubscribe link, and is retried with backoff
 *   if it fails. Someone who unsubscribes gets nothing more.
 *
 * The automation itself (name, steps, pause, archive) is read and written
 * through the framework model's generated CRUD at `/api/automations`, which
 * `config/security.ts` publishes. That PATCH could also set `active`; this
 * page never sends it, and turning on goes through publish only.
 *
 * ## What the page does not do
 *
 * No branches, no conditions and no approvals. Nothing that happened before
 * an automation was turned on starts it, unless whoever turns it on
 * chooses to include the people who already qualify.
 */
import { formatSeen } from './contacts-query'
import { formatCount } from './workspace-summary'

export const AUTOMATIONS_ENDPOINT = '/api/automations'
export const ACTIVITY_ENDPOINT = '/api/v1/automations/activity'
export const AUTOMATIONS_PER_PAGE = 25

/** The limit the model's own validation declares. The floor is this page's. */
export const AUTOMATION_NAME_MIN = 3
export const AUTOMATION_NAME_MAX = 255

/**
 * The step limits `app/Support/automationGraph.ts` applies when turning an
 * automation on. Written out here because a client module cannot import the
 * server's; a test holds the two together.
 */
export const MAX_STEPS = 20
export const SUBJECT_MAX = 200
export const BODY_MAX = 20_000
export const SMS_MAX = 640
export const MIN_DELAY_SECONDS = 60 * 60
export const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60
/** The shape of a step id the server accepts. */
export const STEP_ID = /^[a-z0-9-]{1,60}$/

export const AUTOMATION_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'On' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
] as const

/**
 * The triggers something fires, in the order the page offers them. A test
 * holds this list to `TRIGGER_TYPES` in `app/Support/automationGraph.ts`.
 */
export const TRIGGERS = [
  { value: 'subscriber_joined', label: 'When someone confirms a signup', detail: 'Starts for each person who confirms a signup through one of your forms.' },
  { value: 'purchase_made', label: 'When a contact places an order', detail: 'Starts when a connected store sends an order from someone who is already a contact.' },
  { value: 'cart_abandoned', label: 'When a contact leaves a cart', detail: 'Starts when a contact leaves a cart in a connected Shopify store for an hour without ordering. Each email ends with a link back to the cart, and the messages stop once they buy.' },
] as const

export const DEFAULT_TRIGGER_TYPE = 'subscriber_joined'

const TRIGGER_LABELS: Record<string, string> = Object.fromEntries(TRIGGERS.map(trigger => [trigger.value, trigger.label]))

export const WAIT_UNITS = [
  { value: 'hours', label: 'Hours', seconds: 60 * 60 },
  { value: 'days', label: 'Days', seconds: 24 * 60 * 60 },
] as const

export const HOW_IT_RUNS = 'An automation that is on starts when its trigger happens: once per person for a confirmed signup or an order from someone who is already a contact, and once per cart for a cart they leave. Each email checks that the person still consents and carries an unsubscribe link. A text goes only to someone who agreed to texts, and waits out quiet hours.'

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
 * them: an entry counts only with a string or number `id` and a string
 * `type`. A test holds the two together.
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

export function publishUrl(id: number): string {
  return `/api/v1/automations/${Math.trunc(Number(id))}/publish`
}

export function qualifyingUrl(id: number): string {
  return `/api/v1/automations/${Math.trunc(Number(id))}/qualifying`
}

/** The trigger document to save, or null for a trigger nothing fires. */
export function triggerPayload(type: string): string | null {
  return TRIGGERS.some(item => item.value === type) ? JSON.stringify({ type }) : null
}

/** What turning on with `enroll_existing` will do, in words, before it is pressed. */
export function enrollLabel(count: unknown, limit: unknown): string {
  const people = Math.max(0, Math.floor(Number(count) || 0))
  const cap = Math.max(0, Math.floor(Number(limit) || 0))
  if (people === 0)
    return ''
  if (cap > 0 && people > cap)
    return `Start, and include the first ${formatCount(cap)} of the ${formatCount(people)} who already qualify`
  return `Start, and include the ${plural(people, 'person', 'people')} who already ${people === 1 ? 'qualifies' : 'qualify'}`
}

/** What happened, after turning on. */
/** What turning on means, said while the page asks for the second press. */
export function turnOnNote(canEnroll: boolean): string {
  return canEnroll
    ? 'From now on, everyone its trigger catches gets these messages. "Yes, start sending" leaves out the people who already qualify; the other choice includes them.'
    : 'From now on, everyone its trigger catches gets these messages.'
}

export function turnedOnNotice(enrolled: unknown): string {
  const people = Math.max(0, Math.floor(Number(enrolled) || 0))
  if (people === 0)
    return 'It is on. It starts for each person its trigger catches from now on.'
  return `It is on. ${plural(people, 'person', 'people')} who already qualified ${people === 1 ? 'was' : 'were'} added, and start over the next few minutes.`
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export interface EditorStep {
  /** The node id, kept across edits so a saved step keeps its identity. */
  id: string
  kind: 'email' | 'sms' | 'wait' | 'other'
  subject: string
  body: string
  /** For a wait: the amount in `unit`. */
  amount: number
  unit: 'hours' | 'days'
  /** For a step of another kind, its type, so the page can name it. */
  otherType: string
  /** One line for the list. */
  summary: string
}

/** A wait in the largest unit that divides it evenly. */
export function waitParts(seconds: number): { amount: number, unit: 'hours' | 'days' } {
  const day = 24 * 60 * 60
  if (seconds >= day && seconds % day === 0)
    return { amount: seconds / day, unit: 'days' }
  return { amount: Math.max(1, Math.round(seconds / 3600)), unit: 'hours' }
}

export function waitSeconds(amount: unknown, unit: unknown): number {
  const per = WAIT_UNITS.find(item => item.value === unit)?.seconds ?? 3600
  const count = Number(amount)
  return Number.isFinite(count) ? Math.round(count * per) : 0
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
}

export function stepSummary(step: Pick<EditorStep, 'kind' | 'subject' | 'body' | 'amount' | 'unit' | 'otherType'>): string {
  if (step.kind === 'email')
    return step.subject.trim() ? `Send an email: ${step.subject.trim()}` : 'Send an email, with no subject yet'
  if (step.kind === 'sms') {
    const text = step.body.replace(/\s+/g, ' ').trim()
    return text ? `Send a text: ${text.length > 48 ? `${text.slice(0, 47)}...` : text}` : 'Send a text, with nothing in it yet'
  }
  if (step.kind === 'wait')
    return `Wait ${step.unit === 'days' ? plural(step.amount, 'day', 'days') : plural(step.amount, 'hour', 'hours')}`
  return `${titleCase(step.otherType || 'unknown')}: this kind of step cannot run yet`
}

function makeStep(id: string, kind: EditorStep['kind'], fields: Partial<EditorStep>): EditorStep {
  const step: EditorStep = { id, kind, subject: '', body: '', amount: 1, unit: 'days', otherType: '', summary: '', ...fields }
  step.summary = stepSummary(step)
  return step
}

/** A saved graph as editable steps, in order, with its sender. */
export function toEditorSteps(graph: unknown): { senderId: number, steps: EditorStep[] } {
  const doc = parseDocument(graph) as { nodes?: unknown, sender_identity_id?: unknown } | null
  const senderId = Number(doc?.sender_identity_id)
  const nodes = doc && typeof doc === 'object' && Array.isArray(doc.nodes) ? doc.nodes : []
  const steps: EditorStep[] = []
  for (const [index, raw] of nodes.entries()) {
    const node = raw as { id?: unknown, type?: unknown, config?: Record<string, unknown> } | null
    const id = typeof node?.id === 'string' || typeof node?.id === 'number' ? String(node.id) : `step-${index + 1}`
    const config = node?.config && typeof node.config === 'object' ? node.config : {}
    if (node?.type === 'send_email')
      steps.push(makeStep(id, 'email', { subject: String(config.subject ?? ''), body: String(config.body ?? '') }))
    else if (node?.type === 'send_sms')
      steps.push(makeStep(id, 'sms', { body: String(config.body ?? '') }))
    else if (node?.type === 'delay')
      steps.push(makeStep(id, 'wait', waitParts(Number(config.seconds) || 3600)))
    else
      steps.push(makeStep(id, 'other', { otherType: typeof node?.type === 'string' ? node.type : 'unknown' }))
  }
  return { senderId: Number.isSafeInteger(senderId) && senderId > 0 ? senderId : 0, steps }
}

/** An id no other step uses: the shape the server accepts, `[a-z0-9-]`. */
export function newStepId(kind: 'email' | 'sms' | 'wait', steps: Array<{ id: string }>): string {
  const prefix = kind === 'email' ? 'email' : (kind === 'sms' ? 'text' : 'wait')
  const used = new Set(steps.map(step => step.id))
  let number = 1
  while (used.has(`${prefix}-${number}`))
    number++
  return `${prefix}-${number}`
}

export function newEmailStep(steps: Array<{ id: string }>, subject = '', body = ''): EditorStep {
  return makeStep(newStepId('email', steps), 'email', { subject, body })
}

export function newSmsStep(steps: Array<{ id: string }>, body = ''): EditorStep {
  return makeStep(newStepId('sms', steps), 'sms', { body })
}

export function newWaitStep(steps: Array<{ id: string }>, amount = 1, unit: 'hours' | 'days' = 'days'): EditorStep {
  return makeStep(newStepId('wait', steps), 'wait', { amount, unit })
}

/** The same step with new fields, and its summary brought up to date. */
export function withFields(step: EditorStep, fields: Partial<EditorStep>): EditorStep {
  return makeStep(step.id, step.kind, { ...step, ...fields })
}

/** Move a step up (-1) or down (+1). Out of range is no change. */
export function moveStep<T>(steps: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length)
    return steps
  const next = [...steps]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

/**
 * Why one step being edited cannot be kept, by the server's rules. The page
 * checks a step when it is put in the list, so the list only ever holds
 * steps that can run (and any of another kind that were already saved).
 */
export function stepError(step: Pick<EditorStep, 'kind' | 'subject' | 'body' | 'amount' | 'unit'>): string {
  if (step.kind === 'email') {
    const subject = step.subject.replace(/\s+/g, ' ').trim()
    if (!subject)
      return 'An email needs a subject.'
    if (subject.length > SUBJECT_MAX)
      return `A subject can be at most ${SUBJECT_MAX} characters.`
    if (!step.body.trim())
      return 'An email needs a message.'
    if (step.body.trim().length > BODY_MAX)
      return `A message can be at most ${BODY_MAX.toLocaleString('en-US')} characters.`
    return ''
  }
  if (step.kind === 'sms') {
    const body = step.body.trim()
    if (!body)
      return 'A text needs something to say.'
    if (body.length > SMS_MAX)
      return `A text can be at most ${SMS_MAX} characters.`
    return ''
  }
  if (step.kind === 'wait') {
    const amount = Number(step.amount)
    if (!Number.isInteger(amount) || amount < 1)
      return 'A wait needs a whole number of hours or days.'
    const seconds = waitSeconds(amount, step.unit)
    if (seconds < MIN_DELAY_SECONDS || seconds > MAX_DELAY_SECONDS)
      return 'A wait must be between 1 hour and 30 days.'
    return ''
  }
  return ''
}

/**
 * Whether a whole set of steps could be turned on, and if not, the first
 * reason. The same order of checks the server makes, so the page says what
 * the server would.
 */
export function readinessError(senderId: number, steps: EditorStep[]): string {
  if (steps.some(step => step.kind === 'email') && !senderId)
    return 'Choose the sender its emails come from.'
  if (steps.length === 0)
    return 'This automation has no steps.'
  if (steps.length > MAX_STEPS)
    return `An automation can have at most ${MAX_STEPS} steps.`
  const seen = new Set<string>()
  for (const [index, step] of steps.entries()) {
    if (!STEP_ID.test(step.id) || seen.has(step.id))
      return `Step ${index + 1} has a missing or repeated id.`
    seen.add(step.id)
    if (step.kind === 'other')
      return `Step ${index + 1} is a kind of step that cannot run yet. Remove it to turn this automation on.`
    const problem = stepError(step)
    if (problem)
      return `Step ${index + 1}: ${problem}`
  }
  if (!steps.some(step => step.kind === 'email' || step.kind === 'sms'))
    return 'An automation needs at least one message step.'
  if (steps[steps.length - 1]!.kind === 'wait')
    return 'The last step cannot be a wait: nothing would follow it.'
  return ''
}

/**
 * The graph to save. A step of another kind is kept as it was saved, so
 * saving does not quietly delete it; turning on still refuses until it is
 * removed.
 */
export function graphPayload(senderId: number, steps: EditorStep[], original: unknown = null): { graph: string } {
  const doc = parseDocument(original) as { nodes?: unknown[] } | null
  const originals = new Map<string, unknown>()
  for (const node of (doc && Array.isArray(doc.nodes) ? doc.nodes : []))
    originals.set(String((node as { id?: unknown })?.id ?? ''), node)

  const nodes = steps.map((step) => {
    if (step.kind === 'email')
      return { id: step.id, type: 'send_email', config: { subject: step.subject.replace(/\s+/g, ' ').trim(), body: step.body.trim() } }
    if (step.kind === 'sms')
      return { id: step.id, type: 'send_sms', config: { body: step.body.trim() } }
    if (step.kind === 'wait')
      return { id: step.id, type: 'delay', config: { seconds: waitSeconds(step.amount, step.unit) } }
    return originals.get(step.id) ?? { id: step.id, type: step.otherType || 'unknown', config: {} }
  })
  const graph: Record<string, unknown> = { nodes, edges: [] }
  if (senderId > 0)
    graph.sender_identity_id = senderId
  return { graph: JSON.stringify(graph) }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

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

export interface ActivityRow {
  automation_id: number
  version?: number | null
  unpublished_changes?: boolean | null
  runs?: Record<string, unknown> | null
  emails_sent?: number | null
  texts_sent?: number | null
}

export interface Activity {
  byId: Map<number, ActivityRow>
  canPublish: boolean
}

export function toActivity(body: { data?: ActivityRow[], can_publish?: unknown } | null | undefined): Activity {
  return {
    byId: new Map((body?.data ?? []).map(row => [Number(row.automation_id), row])),
    // Only a literal true: a missing answer is not permission.
    canPublish: body?.can_publish === true,
  }
}

const RUN_STATUS_ORDER: Array<[key: string, label: string]> = [
  ['running', 'running'],
  ['queued', 'about to start'],
  ['waiting', 'waiting'],
  ['completed', 'finished'],
  ['cancelled', 'stopped'],
  ['failed', 'failed'],
]

function count(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

/** "3 people: 1 waiting, 2 finished. 4 emails sent." or that nobody has started. */
export function activityLabel(activity: ActivityRow | undefined): string {
  const runs = activity?.runs ?? {}
  const total = RUN_STATUS_ORDER.reduce((sum, [key]) => sum + count(runs[key]), 0)
  if (total === 0)
    return 'Nobody has started it yet.'
  const parts = RUN_STATUS_ORDER.filter(([key]) => count(runs[key]) > 0).map(([key, label]) => `${formatCount(count(runs[key]))} ${label}`)
  const sent = count(activity?.emails_sent)
  const texts = count(activity?.texts_sent)
  const messages = texts > 0 ? `${plural(sent, 'email', 'emails')} and ${plural(texts, 'text', 'texts')}` : plural(sent, 'email', 'emails')
  return `${plural(total, 'person', 'people')}: ${parts.join(', ')}. ${messages} sent.`
}

export interface AutomationView {
  id: number
  name: string
  status: string
  statusLabel: string
  triggerLabel: string
  /** The saved trigger's type, for the editor. */
  triggerType: string
  stepsLabel: string
  graph: string
  publishedLabel: string
  updatedLabel: string
  activityLabel: string
  /** The saved steps differ from the live version. */
  changesNote: string
  canEdit: boolean
  canPause: boolean
  canArchive: boolean
  canRestore: boolean
  /** Turn on (a draft) or Resume (paused), when the caller may. */
  turnOnLabel: string
}

/** Normalize one API row, with what it has done, into the shape the list renders. */
export function toAutomationView(row: AutomationRow, activity?: ActivityRow, canPublish = false, locale?: string): AutomationView {
  const status = String(row.status || 'draft')
  const steps = stepCount(row.graph)
  const version = count(activity?.version)
  const live = status === 'active' || status === 'paused'

  let turnOnLabel = ''
  if (canPublish && status === 'draft')
    turnOnLabel = 'Turn on'
  else if (canPublish && status === 'paused')
    turnOnLabel = activity?.unpublished_changes ? 'Resume with changes' : 'Resume'
  else if (canPublish && status === 'active' && activity?.unpublished_changes)
    turnOnLabel = 'Put changes live'

  return {
    id: row.id,
    name: (row.name || '').trim() || `Automation ${row.id}`,
    status,
    statusLabel: statusLabel(status),
    triggerLabel: triggerLabel(row.trigger),
    triggerType: (() => {
      const doc = parseDocument(row.trigger) as { type?: unknown } | null
      const type = doc && typeof doc === 'object' && typeof doc.type === 'string' ? doc.type : ''
      return TRIGGERS.some(item => item.value === type) ? type : DEFAULT_TRIGGER_TYPE
    })(),
    stepsLabel: steps === 0 ? 'No steps yet' : `${formatCount(steps, locale)} ${steps === 1 ? 'step' : 'steps'}`,
    graph: typeof row.graph === 'string' ? row.graph : JSON.stringify(row.graph ?? { nodes: [], edges: [] }),
    publishedLabel: version > 0 ? `Version ${formatCount(version)}, turned on ${formatSeen(row.published_at, locale)}` : 'Never turned on',
    updatedLabel: formatSeen(row.updated_at, locale),
    activityLabel: version > 0 ? activityLabel(activity) : '',
    changesNote: live && activity?.unpublished_changes ? 'The saved steps differ from the live version. People keep getting the live version until the changes are put live.' : '',
    canEdit: status !== 'archived',
    canPause: status === 'active',
    canArchive: status !== 'archived',
    canRestore: status === 'archived',
    turnOnLabel,
  }
}

export function toAutomationViews(body: { data?: AutomationRow[] } | null | undefined, activity?: Activity, locale?: string): AutomationView[] {
  return (body?.data ?? []).map(row => toAutomationView(row, activity?.byId.get(Number(row.id)), activity?.canPublish ?? false, locale))
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

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
 * Always a draft at version 1, with the one trigger and an empty graph.
 * `trigger` and `graph` are required by the model, so they are always sent.
 */
export function automationPayload(draft: { name?: string, trigger?: string }): { name: string, status: 'draft', version: 1, trigger: string, graph: string } {
  const trigger = TRIGGERS.some(item => item.value === draft.trigger) ? String(draft.trigger) : DEFAULT_TRIGGER_TYPE
  return {
    name: (draft.name ?? '').trim(),
    status: 'draft',
    version: 1,
    trigger: JSON.stringify({ type: trigger }),
    graph: EMPTY_GRAPH,
  }
}

/**
 * The statuses this page sets through the generated update. Never `active`:
 * turning on goes through publish, which checks the steps first.
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

/** What to tell someone when turning on failed; a 422 carries the server's reason. */
export function publishErrorMessage(status: number, reason?: unknown): string {
  if (status === 422 && typeof reason === 'string' && reason.trim())
    return `It cannot be turned on yet. ${reason.trim()}`
  if (status === 403)
    return 'Turning an automation on needs an admin or owner role.'
  if (status === 409)
    return 'Restore this automation as a draft before turning it on.'
  if (status === 404)
    return 'That automation no longer exists. The list has been refreshed.'
  if (status === 429)
    return 'Too many attempts just now. Wait a minute and try again.'
  return `The automation could not be turned on (${status}).`
}
