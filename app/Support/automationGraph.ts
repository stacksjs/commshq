import { createHash } from 'node:crypto'

/**
 * What an automation may hold before it can be turned on.
 *
 * Two kinds of step run today: `send_email`, which sends one email from the
 * automation's sender, and `delay`, which waits. `ProcessAutomationRun` also
 * knew `approval`, and the demo data carries `send_sms`; neither has
 * anything behind it (nobody is asked to approve, and SMS steps have no
 * body or quiet-hours rule), so a graph holding one is refused rather than
 * published to stall or to skip a step silently.
 *
 * One trigger: `subscriber_joined`, which `startAutomations` fires when
 * someone confirms an email subscription through a signup form.
 *
 * The page applies the same rules before it saves; a test holds the two
 * sets of limits together.
 */
export const RUNNABLE_STEP_TYPES = ['send_email', 'delay'] as const
export const TRIGGER_TYPES = ['subscriber_joined'] as const

export const MAX_STEPS = 20
export const SUBJECT_MAX = 200
export const BODY_MAX = 20_000
export const MIN_DELAY_SECONDS = 60 * 60
export const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60
const NODE_ID = /^[a-z0-9-]{1,60}$/

export interface EmailStep { id: string, type: 'send_email', config: { subject: string, body: string } }
export interface DelayStep { id: string, type: 'delay', config: { seconds: number } }
export type RunnableStep = EmailStep | DelayStep

export interface RunnableGraph {
  senderIdentityId: number
  steps: RunnableStep[]
}

function parse(value: unknown): unknown {
  if (typeof value !== 'string')
    return value
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}

/** The trigger's type, or '' when the document holds none. */
export function triggerType(value: unknown): string {
  const doc = parse(value) as { type?: unknown } | null
  return doc && typeof doc === 'object' && typeof doc.type === 'string' ? doc.type.trim() : ''
}

/**
 * Read a graph into steps that can run, or say why it cannot.
 *
 * The first problem found is returned, in words a person can act on. A
 * graph is read whole: there is no partly valid graph to publish.
 */
export function readRunnableGraph(value: unknown): { graph: RunnableGraph | null, error: string } {
  const fail = (error: string) => ({ graph: null, error })
  const doc = parse(value) as { nodes?: unknown, sender_identity_id?: unknown } | null
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes))
    return fail('This automation has no steps.')

  const senderIdentityId = Number(doc.sender_identity_id)
  if (!Number.isSafeInteger(senderIdentityId) || senderIdentityId < 1)
    return fail('Choose the sender its emails come from.')

  const nodes = doc.nodes as unknown[]
  if (nodes.length === 0)
    return fail('This automation has no steps.')
  if (nodes.length > MAX_STEPS)
    return fail(`An automation can have at most ${MAX_STEPS} steps.`)

  const seen = new Set<string>()
  const steps: RunnableStep[] = []
  for (const [index, raw] of nodes.entries()) {
    const number = index + 1
    const node = raw as { id?: unknown, type?: unknown, config?: Record<string, unknown> } | null
    const id = typeof node?.id === 'string' ? node.id : ''
    if (!NODE_ID.test(id) || seen.has(id))
      return fail(`Step ${number} has a missing or repeated id.`)
    seen.add(id)
    const config = node?.config && typeof node.config === 'object' ? node.config : {}

    if (node?.type === 'send_email') {
      const subject = typeof config.subject === 'string' ? config.subject.replace(/\s+/g, ' ').trim() : ''
      const body = typeof config.body === 'string' ? config.body.trim() : ''
      if (!subject)
        return fail(`Step ${number} needs a subject.`)
      if (subject.length > SUBJECT_MAX)
        return fail(`Step ${number} needs a subject of at most ${SUBJECT_MAX} characters.`)
      if (!body)
        return fail(`Step ${number} needs a message.`)
      if (body.length > BODY_MAX)
        return fail(`Step ${number} needs a message of at most ${BODY_MAX.toLocaleString('en-US')} characters.`)
      steps.push({ id, type: 'send_email', config: { subject, body } })
      continue
    }

    if (node?.type === 'delay') {
      const seconds = Number(config.seconds)
      if (!Number.isInteger(seconds) || seconds < MIN_DELAY_SECONDS || seconds > MAX_DELAY_SECONDS)
        return fail(`Step ${number} needs a wait between 1 hour and 30 days.`)
      steps.push({ id, type: 'delay', config: { seconds } })
      continue
    }

    return fail(`Step ${number} is a kind of step that cannot run yet. Remove it to turn this automation on.`)
  }

  if (!steps.some(step => step.type === 'send_email'))
    return fail('An automation needs at least one email step.')
  if (steps[steps.length - 1]!.type === 'delay')
    return fail('The last step cannot be a wait: nothing would follow it.')

  return { graph: { senderIdentityId, steps }, error: '' }
}

/** The graph as it is stored in a version: canonical, so equal graphs share a checksum. */
export function canonicalGraph(graph: RunnableGraph): string {
  return JSON.stringify({ sender_identity_id: graph.senderIdentityId, nodes: graph.steps, edges: [] })
}

export function graphChecksum(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex')
}

/** A run is started once per automation per contact, ever. */
export function runIdempotencyKey(automationId: number, trigger: string, contactId: number): string {
  return `automation:${automationId}:${trigger}:contact:${contactId}`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * A plain-text message as email HTML: escaped, with a paragraph per blank
 * line and a line break per newline. Nothing the author typed becomes markup.
 */
export function messageHtml(body: string): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map(paragraph => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}
