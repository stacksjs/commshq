import { randomUUID } from 'node:crypto'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { isUniqueViolation } from '@stacksjs/orm'
import { job } from '@stacksjs/queue'
import { runIdempotencyKey, triggerType, versionTrigger } from './automationGraph'

/**
 * Starting runs, and the sender a run sends from.
 *
 * `startAutomations` is called where something happens that an automation
 * can wait for: someone confirming an email subscription through a signup
 * form (`subscriber_joined`), and a connected store recording an order from
 * a known contact (`purchase_made`, from `commerceAttribution`). A contact
 * added on the Contacts page starts nothing. Every email a run sends still
 * checks the contact's consent first, whatever started it.
 *
 * Each active automation with a published version gets one run per contact,
 * ever: the run's idempotency key is unique, so a second confirmation, or a
 * contact who leaves and comes back, does not get the welcome again.
 *
 * Starting a run never fails the request that caused it. A signup that
 * cannot start an automation is still a signup.
 */
export interface StartedRun { runId: number, automationId: number }

export async function latestVersion(teamId: number, automationId: number): Promise<{ id: number, version: number, graph: string, checksum: string } | undefined> {
  return await db.selectFrom('automation_versions' as any)
    .select(['id', 'version', 'graph', 'checksum'] as any)
    .where('team_id' as any, '=', teamId)
    .where('automation_id' as any, '=', automationId)
    .orderBy('version' as any, 'desc')
    .executeTakeFirst() as any
}

export async function startAutomations(teamId: number, trigger: string, contactId: number): Promise<StartedRun[]> {
  const started: StartedRun[] = []
  try {
    const automations = await db.selectFrom('automations' as any)
      .select(['id', 'trigger'] as any)
      .where('team_id' as any, '=', teamId)
      .where('status' as any, '=', 'active')
      .execute() as Array<{ id: number, trigger: unknown }>

    for (const automation of automations) {
      const version = await latestVersion(teamId, Number(automation.id))
      if (!version)
        continue
      // The live version's trigger, so a saved but unpublished change of
      // trigger does not take effect until it is put live. Versions from
      // before triggers were versioned fall back to the automation's own.
      if ((versionTrigger(version.graph) || triggerType(automation.trigger)) !== trigger)
        continue

      const now = new Date().toISOString()
      try {
        await db.insertInto('automation_runs' as any).values({
          team_id: teamId,
          automation_id: Number(automation.id),
          uuid: randomUUID(),
          status: 'queued',
          version: Number(version.version),
          subject_type: 'contact',
          subject_id: String(contactId),
          context: JSON.stringify({ trigger }),
          idempotency_key: runIdempotencyKey(Number(automation.id), trigger, contactId),
          created_at: now,
          updated_at: now,
        } as any).execute()
      }
      catch (error) {
        // Already started for this contact: that is the rule, not a failure.
        if (isUniqueViolation(error))
          continue
        throw error
      }

      const row = await db.selectFrom('automation_runs' as any).select(['id'] as any)
        .where('idempotency_key' as any, '=', runIdempotencyKey(Number(automation.id), trigger, contactId))
        .executeTakeFirst() as { id: number } | undefined
      if (row)
        started.push({ runId: Number(row.id), automationId: Number(automation.id) })
    }

    for (const run of started) {
      await job('ProcessAutomationRun', { runId: run.runId, teamId })
        .withIdempotencyKey(`automation-run:${run.runId}:start`)
        .onQueue('automations')
        .dispatch()
    }
  }
  catch (error) {
    log.error(`[automation] could not start ${trigger} runs for contact ${contactId} in team ${teamId}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return started
}

export interface VerifiedSender { id: number, name: string, address: string, replyTo: string | null }

/**
 * The sender, if it is a verified email sender of this workspace at a
 * domain that is verified now. Checked when an automation is turned on and
 * again before every send, since a domain can lose its verification.
 */
export async function verifiedSender(teamId: number, senderIdentityId: number): Promise<VerifiedSender | null> {
  const sender = await db.selectFrom('sender_identities' as any)
    .select(['id', 'name', 'address', 'reply_to'] as any)
    .where('id' as any, '=', senderIdentityId)
    .where('team_id' as any, '=', teamId)
    .where('channel' as any, '=', 'email')
    .where('status' as any, '=', 'verified')
    .executeTakeFirst() as { id: number, name: string, address: string, reply_to: string | null } | undefined
  if (!sender)
    return null
  const domain = String(sender.address || '').split('@')[1]?.toLowerCase() ?? ''
  if (!domain)
    return null
  const verified = await db.selectFrom('sender_domains' as any).select(['id'] as any)
    .where('team_id' as any, '=', teamId)
    .where('domain' as any, '=', domain)
    .where('status' as any, '=', 'verified')
    .executeTakeFirst()
  if (!verified)
    return null
  return { id: Number(sender.id), name: String(sender.name || ''), address: String(sender.address), replyTo: sender.reply_to || null }
}

/** The most people enrolled in one go, so turning on cannot write an unbounded batch. */
export const ENROLL_LIMIT = 5000

/**
 * The contacts who already meet an automation's trigger and have never been
 * through it: for `subscriber_joined`, active contacts whose latest email
 * consent is a confirmation or grant and who are not suppressed; for
 * `purchase_made`, contacts a connected store has recorded an order from.
 *
 * Read and filtered here rather than in SQL: "latest consent per address"
 * is spelled differently in every database, and a workspace's contacts fit
 * in memory well past the size this is meant for.
 */
export async function qualifyingContacts(teamId: number, automationId: number, trigger: string): Promise<number[]> {
  let ids: number[] = []

  if (trigger === 'subscriber_joined') {
    const [contacts, consents, suppressions] = await Promise.all([
      db.selectFrom('contacts' as any).select(['id', 'email'] as any)
        .where('team_id' as any, '=', teamId).where('status' as any, '=', 'active').execute() as unknown as Promise<Array<{ id: number, email: string | null }>>,
      db.selectFrom('consent_events' as any).select(['recipient', 'action', 'occurred_at'] as any)
        .where('team_id' as any, '=', teamId).where('channel' as any, '=', 'email')
        .orderBy('occurred_at' as any, 'asc').execute() as unknown as Promise<Array<{ recipient: string, action: string }>>,
      db.selectFrom('communication_suppressions' as any).select(['recipient', 'lifted_at'] as any)
        .where('team_id' as any, '=', teamId).where('channel' as any, '=', 'email').execute() as unknown as Promise<Array<{ recipient: string, lifted_at: unknown }>>,
    ])
    // Ascending, so the last entry written for an address is its latest.
    const latest = new Map<string, string>()
    for (const consent of consents)
      latest.set(String(consent.recipient).trim().toLowerCase(), String(consent.action))
    const suppressed = new Set(suppressions.filter(row => !row.lifted_at).map(row => String(row.recipient).trim().toLowerCase()))
    ids = contacts
      .filter((contact) => {
        const email = String(contact.email ?? '').trim().toLowerCase()
        return email !== '' && !suppressed.has(email) && ['confirmed', 'granted'].includes(latest.get(email) ?? '')
      })
      .map(contact => Number(contact.id))
  }
  else if (trigger === 'purchase_made') {
    const rows = await db.selectFrom('commerce_events' as any).select(['contact_id'] as any)
      .where('team_id' as any, '=', teamId).where('type' as any, '=', 'order_created')
      .where('contact_id' as any, 'is not', null).execute() as unknown as Array<{ contact_id: number }>
    ids = [...new Set(rows.map(row => Number(row.contact_id)))]
  }

  if (ids.length === 0)
    return []
  const already = await db.selectFrom('automation_runs' as any).select(['subject_id'] as any)
    .where('team_id' as any, '=', teamId).where('automation_id' as any, '=', automationId)
    .where('subject_type' as any, '=', 'contact').execute() as unknown as Array<{ subject_id: string }>
  const started = new Set(already.map(row => Number(row.subject_id)))
  return ids.filter(id => id > 0 && !started.has(id)).sort((a, b) => a - b)
}

/**
 * Queue a run for each contact, for a version that is live. Queued, not
 * dispatched: `ResumeAutomationRuns` hands queued runs to the runner a
 * batch a minute, so a large enrollment is spread out rather than sent in
 * one burst. Idempotent per contact, like every other start.
 */
export async function enrollContacts(teamId: number, automationId: number, version: number, trigger: string, contactIds: number[]): Promise<number> {
  let enrolled = 0
  for (const contactId of contactIds.slice(0, ENROLL_LIMIT)) {
    const now = new Date().toISOString()
    try {
      await db.insertInto('automation_runs' as any).values({
        team_id: teamId,
        automation_id: automationId,
        uuid: randomUUID(),
        status: 'queued',
        version,
        subject_type: 'contact',
        subject_id: String(contactId),
        context: JSON.stringify({ trigger, enrolled: 'existing' }),
        idempotency_key: runIdempotencyKey(automationId, trigger, contactId),
        created_at: now,
        updated_at: now,
      } as any).execute()
      enrolled++
    }
    catch (error) {
      if (!isUniqueViolation(error))
        throw error
    }
  }
  return enrolled
}
