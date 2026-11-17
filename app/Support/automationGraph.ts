import { createHash } from 'node:crypto'

/**
 * What an automation may hold before it can be turned on.
 *
 * Three kinds of step run: `send_email`, one email from the automation's
 * sender; `send_sms`, one text through the deployment's SMS provider, held
 * outside quiet hours; and `delay`, which waits. `ProcessAutomationRun`
 * also knew `approval`, which nothing ever asked anyone to give, so a graph
 * holding one is refused rather than published to stall.
 *
 * Three triggers, fired through `startAutomations`: `subscriber_joined`,
 * when someone confirms an email subscription through a signup form;
 * `purchase_made`, when a connected store records an order from an email
 * address the workspace already has as a contact (`commerceAttribution`);
 * and `cart_abandoned`, when a contact's cart has gone quiet without an
 * order (`commerceCarts`).
 *
 * The page applies the same rules before it saves; a test holds the two
 * sets of limits together.
 */
export const RUNNABLE_STEP_TYPES = ['send_email', 'send_sms', 'delay'] as const
export const TRIGGER_TYPES = ['subscriber_joined', 'purchase_made', 'cart_abandoned'] as const

export const MAX_STEPS = 20
export const SUBJECT_MAX = 200
export const BODY_MAX = 20_000
/** Four texts' worth: long enough for a message, short enough not to surprise anyone's bill. */
export const SMS_MAX = 640
export const MIN_DELAY_SECONDS = 60 * 60
export const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60
const NODE_ID = /^[a-z0-9-]{1,60}$/

export interface EmailStep { id: string, type: 'send_email', config: { subject: string, body: string } }
export interface SmsStep { id: string, type: 'send_sms', config: { body: string } }
export interface DelayStep { id: string, type: 'delay', config: { seconds: number } }
export type RunnableStep = EmailStep | SmsStep | DelayStep

export interface RunnableGraph {
  /** 0 when the automation sends no email, which needs no sender. */
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

  const nodes = doc.nodes as unknown[]
  const sendsEmail = nodes.some(node => (node as { type?: unknown } | null)?.type === 'send_email')
  const rawSender = Number(doc.sender_identity_id)
  const senderIdentityId = Number.isSafeInteger(rawSender) && rawSender > 0 ? rawSender : 0
  if (sendsEmail && !senderIdentityId)
    return fail('Choose the sender its emails come from.')

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

    if (node?.type === 'send_sms') {
      const body = typeof config.body === 'string' ? config.body.trim() : ''
      if (!body)
        return fail(`Step ${number} needs a text.`)
      if (body.length > SMS_MAX)
        return fail(`Step ${number} needs a text of at most ${SMS_MAX} characters.`)
      steps.push({ id, type: 'send_sms', config: { body } })
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

  if (!steps.some(step => step.type !== 'delay'))
    return fail('An automation needs at least one message step.')
  if (steps[steps.length - 1]!.type === 'delay')
    return fail('The last step cannot be a wait: nothing would follow it.')

  return { graph: { senderIdentityId: sendsEmail ? senderIdentityId : 0, steps }, error: '' }
}

/**
 * The graph as it is stored in a version: canonical, so equal graphs share
 * a checksum. The trigger is part of it, so changing what starts an
 * automation is a change that has to be put live like any other, rather
 * than one that takes effect the moment it is saved.
 */
export function canonicalGraph(graph: RunnableGraph, trigger: string): string {
  return JSON.stringify({ trigger, sender_identity_id: graph.senderIdentityId, nodes: graph.steps, edges: [] })
}

/** The trigger a version was published with, or '' for one published before triggers were versioned. */
export function versionTrigger(graph: unknown): string {
  const doc = parse(graph) as { trigger?: unknown } | null
  return doc && typeof doc === 'object' && typeof doc.trigger === 'string' ? doc.trigger : ''
}

export function graphChecksum(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * One run per contact per automation, or with an `occasion`, one per
 * occasion: a cart automation runs once for each abandoned cart, not once
 * for each shopper ever.
 */
export function runIdempotencyKey(automationId: number, trigger: string, contactId: number, occasion?: string): string {
  const key = `automation:${automationId}:${trigger}:contact:${contactId}`
  return occasion ? `${key}:${occasion}` : key
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The link back to an abandoned cart, added to the end of every email a cart
 * automation sends, before the unsubscribe footer. Added rather than placed
 * by the author, so a reminder can never go out without the one thing it
 * is for.
 */
export const CART_LINK_LABEL = 'Return to your cart'

export function withCartLink(html: string, text: string, url: string | null): { html: string, text: string } {
  if (!url)
    return { html, text }
  return {
    html: `${html}\n<p><a href="${escapeHtml(url)}">${CART_LINK_LABEL}</a></p>`,
    text: `${text.trim()}\n\n${CART_LINK_LABEL}: ${url}`,
  }
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
