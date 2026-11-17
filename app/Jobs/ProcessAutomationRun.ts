import { randomUUID } from 'node:crypto'
import { config } from '@stacksjs/config'
import { db } from '@stacksjs/database'
import { mail } from '@stacksjs/email'
import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { estimateSmsSegments, isWithinSmsQuietHours, sendSms } from '@stacksjs/sms'
import { withUnsubscribe } from '../Mail/unsubscribe'
import { messageHtml, readRunnableGraph, withCartLink } from '../Support/automationGraph'
import type { RunnableStep } from '../Support/automationGraph'
import { automationStepKey } from '../Support/automationFlow'
import { verifiedSender } from '../Support/automationRunner'
import { runCart } from '../Support/commerceCarts'
import { assertQuota, consentAllows } from '../Support/emailDelivery'
import { createPublicToken } from '../Support/signedToken'

/**
 * Walk one run through the version it started on.
 *
 * The run is claimed first, by moving it to `running` only if it is `queued`
 * or `waiting`, so two workers handed the same run cannot both send. Every
 * way out of the job puts it in a state that says what happens next:
 *
 * - `waiting`: a wait step, or a failed send backing off, has an
 *   `available_at`. `ResumeAutomationRuns` hands it back when that passes.
 * - `queued`: ready to go on, for instance after its automation was paused
 *   part way and turned back on.
 * - `completed`, `cancelled` or `failed`: finished.
 *
 * The job never throws to be retried. A failed send is retried by the same
 * resume path, with its own backoff, and after the last attempt the step is
 * dead-lettered and the run fails, so the queue's retries and this cannot
 * both send the same email.
 *
 * An email step needs the contact's email consent, and without it the run
 * ends. A text step needs a phone number and SMS consent, and without them
 * only that text is skipped. A text due inside quiet hours is held and
 * looked at again every `QUIET_HOURS_RECHECK_MINUTES`.
 *
 * A run started for an abandoned cart reads the cart before each message:
 * once the cart is bought the run ends, and each email ends with a link
 * back to the cart.
 *
 * It replaced a job that marked every email step "accepted" without sending
 * it, and whose wait step, once due, waited again forever.
 */

interface AutomationPayload { runId: number, teamId: number }

/** Minutes between attempts at a failed send. Five attempts in all. */
export const SEND_BACKOFF_MINUTES = [5, 30, 120, 720]
export const MAX_SEND_ATTEMPTS = SEND_BACKOFF_MINUTES.length + 1

/** How long a text held for quiet hours waits before it is looked at again. */
export const QUIET_HOURS_RECHECK_MINUTES = 30

/** The contact's own timezone when its properties name a real one, else UTC. */
export function contactTimezone(properties: unknown): string {
  let doc: unknown = properties
  if (typeof properties === 'string') {
    try {
      doc = JSON.parse(properties)
    }
    catch {
      return 'UTC'
    }
  }
  const zone = doc && typeof doc === 'object' ? (doc as { timezone?: unknown }).timezone : undefined
  if (typeof zone !== 'string' || !zone.trim())
    return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone.trim() })
    return zone.trim()
  }
  catch {
    return 'UTC'
  }
}

/** Long enough to outlive any inbox it sits in, as for campaigns. */
const UNSUBSCRIBE_LINK_TTL_MS = 400 * 24 * 60 * 60 * 1000

type Outcome = Record<string, unknown>

function nowIso(): string {
  return new Date().toISOString()
}

async function setRun(runId: number, teamId: number, values: Record<string, unknown>): Promise<void> {
  await db.updateTable('automation_runs' as any).set({ ...values, updated_at: nowIso() } as any)
    .where('id' as any, '=', runId).where('team_id' as any, '=', teamId).execute()
}

async function setStep(stepId: number, teamId: number, values: Record<string, unknown>): Promise<void> {
  await db.updateTable('automation_step_runs' as any).set({ ...values, updated_at: nowIso() } as any)
    .where('id' as any, '=', stepId).where('team_id' as any, '=', teamId).execute()
}

async function automationStatus(teamId: number, automationId: number): Promise<string | null> {
  const row = await db.selectFrom('automations' as any).select(['status'] as any)
    .where('id' as any, '=', automationId).where('team_id' as any, '=', teamId).executeTakeFirst() as { status: string } | undefined
  return row ? String(row.status) : null
}

/** Stop a run for good, along with any step that was still to happen. */
async function finish(runId: number, teamId: number, status: 'completed' | 'cancelled' | 'failed', error: string | null): Promise<void> {
  if (status !== 'completed') {
    await db.updateTable('automation_step_runs' as any).set({ status: 'cancelled', updated_at: nowIso() } as any)
      .where('automation_run_id' as any, '=', runId).where('team_id' as any, '=', teamId)
      .where('status' as any, 'in', ['queued', 'waiting', 'failed', 'running']).execute()
  }
  await setRun(runId, teamId, { status, error, finished_at: nowIso(), current_node_id: null })
}

/** The cart a run was started for, from its stored context, or 0. */
export function contextCartId(context: unknown): number {
  let doc: unknown = context
  if (typeof context === 'string') {
    try {
      doc = JSON.parse(context)
    }
    catch {
      return 0
    }
  }
  const id = doc && typeof doc === 'object' ? Number((doc as { cartId?: unknown }).cartId) : 0
  return Number.isInteger(id) && id > 0 ? id : 0
}

async function sendEmail(teamId: number, contact: { id: number, email: string }, senderIdentityId: number, step: Extract<RunnableStep, { type: 'send_email' }>, cartUrl: string | null): Promise<string | undefined> {
  const sender = await verifiedSender(teamId, senderIdentityId)
  if (!sender)
    throw new Error('The sender is no longer verified, or its domain is not')
  await assertQuota(teamId, 'email', 1)

  const token = createPublicToken({ teamId, contactId: contact.id, channel: 'email', purpose: 'unsubscribe', expiresAt: Date.now() + UNSUBSCRIBE_LINK_TTL_MS }, String(config.app.key))
  const message = withCartLink(messageHtml(step.config.body), step.config.body, cartUrl)
  const body = withUnsubscribe(message.html, message.text, `${String(config.app.url).replace(/\/$/, '')}/unsubscribe/${token}`)
  const result = await mail.send({
    to: [contact.email],
    from: { name: sender.name || sender.address, address: sender.address },
    replyTo: sender.replyTo || undefined,
    subject: step.config.subject,
    html: body.html,
    text: body.text,
    headers: body.headers,
  } as any)
  if (result?.success === false)
    throw new Error(result.message || 'Mail server rejected the message')
  return result?.messageId
}

export default new Job({
  name: 'ProcessAutomationRun',
  description: 'Walks one automation run through its published version, sending its emails',
  queue: 'automations',
  tries: 1,

  async handle(payload: AutomationPayload): Promise<Outcome> {
    const teamId = Number(payload.teamId)
    const runId = Number(payload.runId)

    const claimed = await db.updateTable('automation_runs' as any).set({ status: 'running', updated_at: nowIso() } as any)
      .where('id' as any, '=', runId).where('team_id' as any, '=', teamId)
      .where('status' as any, 'in', ['queued', 'waiting'])
      .executeTakeFirst() as { numUpdatedRows?: bigint | number }
    if (Number(claimed?.numUpdatedRows ?? 0) !== 1)
      return { skipped: 'not ready, or another worker has it' }

    const run = await db.selectFrom('automation_runs' as any).selectAll()
      .where('id' as any, '=', runId).where('team_id' as any, '=', teamId).executeTakeFirst() as any
    const automationId = Number(run.automation_id)

    const status = await automationStatus(teamId, automationId)
    if (status === null || status === 'archived') {
      await finish(runId, teamId, 'cancelled', 'The automation was archived')
      return { cancelled: 'archived' }
    }
    if (status !== 'active') {
      // Paused: hand it back untouched. It goes on when the automation does.
      await setRun(runId, teamId, { status: 'queued' })
      return { paused: true }
    }

    const version = await db.selectFrom('automation_versions' as any).select(['graph'] as any)
      .where('team_id' as any, '=', teamId).where('automation_id' as any, '=', automationId)
      .where('version' as any, '=', Number(run.version)).executeTakeFirst() as { graph: string } | undefined
    const { graph, error } = readRunnableGraph(version?.graph)
    if (!version || !graph) {
      await finish(runId, teamId, 'failed', version ? `The published version cannot run: ${error}` : 'The published version was not found')
      return { failed: 'version' }
    }

    const contact = await db.selectFrom('contacts' as any).select(['id', 'email', 'phone', 'status', 'properties'] as any)
      .where('id' as any, '=', Number(run.subject_id)).where('team_id' as any, '=', teamId)
      .executeTakeFirst() as { id: number, email: string | null, phone: string | null, status: string, properties: unknown } | undefined
    if (!contact) {
      await finish(runId, teamId, 'cancelled', 'The contact no longer exists')
      return { cancelled: 'contact' }
    }

    if (!run.started_at)
      await setRun(runId, teamId, { status: 'running', started_at: nowIso() })

    const cartId = contextCartId(run.context)

    for (const step of graph.steps) {
      const existing = await db.selectFrom('automation_step_runs' as any).selectAll()
        .where('automation_run_id' as any, '=', runId).where('team_id' as any, '=', teamId)
        .where('node_id' as any, '=', step.id).executeTakeFirst() as any
      if (existing && existing.status === 'completed')
        continue

      const due = !existing?.available_at || new Date(existing.available_at).getTime() <= Date.now()
      if (existing && !due) {
        await setRun(runId, teamId, { status: 'waiting', current_node_id: step.id })
        return { waiting: step.id }
      }

      let stepId = existing ? Number(existing.id) : 0
      if (!existing) {
        const now = nowIso()
        const waitUntil = step.type === 'delay' ? new Date(Date.now() + step.config.seconds * 1000).toISOString() : null
        await db.insertInto('automation_step_runs' as any).values({
          team_id: teamId,
          automation_run_id: runId,
          uuid: randomUUID(),
          node_id: step.id,
          type: step.type,
          status: step.type === 'delay' ? 'waiting' : 'running',
          attempt: 1,
          idempotency_key: automationStepKey(runId, Number(run.version), step.id),
          input: JSON.stringify(step.config),
          available_at: waitUntil,
          started_at: now,
          created_at: now,
          updated_at: now,
        } as any).execute()
        const created = await db.selectFrom('automation_step_runs' as any).select(['id'] as any)
          .where('idempotency_key' as any, '=', automationStepKey(runId, Number(run.version), step.id)).executeTakeFirst() as { id: number }
        stepId = Number(created.id)

        if (step.type === 'delay') {
          await setRun(runId, teamId, { status: 'waiting', current_node_id: step.id })
          return { waiting: step.id, until: waitUntil }
        }
      }

      if (step.type === 'delay') {
        // Due: the wait is over.
        await setStep(stepId, teamId, { status: 'completed', completed_at: nowIso(), output: JSON.stringify({ waited: true }) })
        continue
      }

      // Re-read before each send: a pause or archive takes effect between messages.
      const current = await automationStatus(teamId, automationId)
      if (current !== 'active') {
        if (current === 'archived' || current === null) {
          await finish(runId, teamId, 'cancelled', 'The automation was archived')
          return { cancelled: 'archived' }
        }
        await setRun(runId, teamId, { status: 'queued', current_node_id: step.id })
        return { paused: true }
      }

      // A cart reminder stops once the cart is bought, or gone.
      let cartUrl: string | null = null
      if (cartId) {
        const cart = await runCart(teamId, cartId)
        if (!cart || cart.status === 'completed' || cart.status === 'recovered') {
          await setStep(stepId, teamId, { status: 'cancelled', output: JSON.stringify({ skipped: 'cart bought' }) })
          await finish(runId, teamId, 'cancelled', cart ? 'The cart was bought' : 'The cart no longer exists')
          return { cancelled: 'cart' }
        }
        cartUrl = cart.recoveryUrl
      }

      const address = String(contact.email ?? '').trim().toLowerCase()
      const phone = String(contact.phone ?? '').trim()

      if (step.type === 'send_email' && (contact.status !== 'active' || !address || !await consentAllows(teamId, 'email', address))) {
        // Email is what these journeys are mostly made of: someone who has
        // left the list leaves the journey.
        await setStep(stepId, teamId, { status: 'cancelled', output: JSON.stringify({ skipped: 'no consent' }) })
        await finish(runId, teamId, 'cancelled', 'The contact no longer consents to email')
        return { cancelled: 'consent' }
      }

      if (step.type === 'send_sms') {
        if (contact.status !== 'active' || !phone || !await consentAllows(teamId, 'sms', phone)) {
          // A text is skipped, not the journey: most people on an email list
          // never gave a number, or never agreed to texts.
          await setStep(stepId, teamId, { status: 'completed', completed_at: nowIso(), output: JSON.stringify({ skipped: phone ? 'no sms consent' : 'no phone number' }) })
          continue
        }
        if (isWithinSmsQuietHours(new Date(), { startHour: Number(config.sms?.quietHours?.startHour ?? 20), endHour: Number(config.sms?.quietHours?.endHour ?? 8), timezone: contactTimezone(contact.properties) })) {
          const later = new Date(Date.now() + QUIET_HOURS_RECHECK_MINUTES * 60_000).toISOString()
          await setStep(stepId, teamId, { status: 'waiting', available_at: later, output: JSON.stringify({ held: 'quiet hours' }) })
          await setRun(runId, teamId, { status: 'waiting', current_node_id: step.id })
          return { quietHours: step.id, until: later }
        }
      }

      await setStep(stepId, teamId, { status: 'running', error: null })
      await setRun(runId, teamId, { current_node_id: step.id })
      try {
        if (step.type === 'send_sms') {
          const segments = estimateSmsSegments(step.config.body).segments
          await assertQuota(teamId, 'sms', segments)
          const result = await sendSms({ to: phone, body: step.config.body, statusCallback: config.sms?.drivers?.twilio?.statusCallback } as any)
          if (!result?.success)
            throw new Error(result?.error || 'SMS provider rejected the message')
          await setStep(stepId, teamId, { status: 'completed', completed_at: nowIso(), output: JSON.stringify({ sent: true, messageId: result.messageId ?? null, segments }) })
        }
        else {
          const messageId = await sendEmail(teamId, { id: Number(contact.id), email: address }, graph.senderIdentityId, step, cartUrl)
          await setStep(stepId, teamId, { status: 'completed', completed_at: nowIso(), output: JSON.stringify({ sent: true, messageId: messageId ?? null }) })
        }
      }
      catch (sendError) {
        const message = (sendError instanceof Error ? sendError.message : String(sendError)).slice(0, 2000)
        const attempt = Number(existing?.attempt ?? 1)
        log.error(`[automation] run ${runId} step ${step.id} attempt ${attempt} failed: ${message}`)

        if (attempt >= MAX_SEND_ATTEMPTS) {
          await setStep(stepId, teamId, { status: 'dead_lettered', error: message })
          await db.insertInto('automation_dead_letters' as any).values({
            team_id: teamId,
            automation_id: automationId,
            automation_run_id: runId,
            automation_step_run_id: stepId,
            uuid: randomUUID(),
            node_id: step.id,
            payload: JSON.stringify({ runId, nodeId: step.id }),
            error_class: sendError instanceof Error ? sendError.name : 'Error',
            error_message: message,
            attempts: attempt,
            status: 'open',
            created_at: nowIso(),
            updated_at: nowIso(),
          } as any).execute()
          await finish(runId, teamId, 'failed', `Step ${step.id} could not be sent after ${attempt} attempts: ${message}`)
          return { failed: step.id }
        }

        const retryAt = new Date(Date.now() + SEND_BACKOFF_MINUTES[attempt - 1]! * 60_000).toISOString()
        await setStep(stepId, teamId, { status: 'failed', error: message, attempt: attempt + 1, available_at: retryAt })
        await setRun(runId, teamId, { status: 'waiting', current_node_id: step.id })
        return { retrying: step.id, at: retryAt }
      }
    }

    await finish(runId, teamId, 'completed', null)
    return { completed: true }
  },
})
