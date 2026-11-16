import { randomUUID } from 'node:crypto'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { isUniqueViolation } from '@stacksjs/orm'
import { job } from '@stacksjs/queue'
import { runIdempotencyKey, triggerType } from './automationGraph'

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
      if (triggerType(automation.trigger) !== trigger)
        continue
      const version = await latestVersion(teamId, Number(automation.id))
      if (!version)
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
