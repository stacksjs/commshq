import { randomUUID } from 'node:crypto'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { isUniqueViolation } from '@stacksjs/orm'
import { startAutomations } from './automationRunner'

/**
 * What a recorded order means for the rest of the workspace.
 *
 * Three things, each idempotent, so a webhook processed twice changes
 * nothing the second time:
 *
 * 1. **The buyer.** The order's email is matched to a contact the workspace
 *    already has. No contact is created: buying something is not consent
 *    to marketing, and a contact row is what campaigns send to.
 * 2. **The credit.** A new order from a known contact is credited to the
 *    most recent email that contact was sent, by a campaign or an
 *    automation, in the `ATTRIBUTION_WINDOW_DAYS` before the order. One
 *    credit per order, last touch, and only email this workspace actually
 *    handed to the mail server. An order with no such email gets no credit;
 *    it is still an order.
 * 3. **The trigger.** A new order from a known contact starts automations
 *    waiting for `purchase_made`, once per contact, like any trigger.
 *
 * Refunds and fulfilments are matched to the buyer but credit nothing and
 * start nothing.
 */
export const ATTRIBUTION_WINDOW_DAYS = 5

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The buyer's email in a Shopify or WooCommerce order, or ''. */
export function buyerEmail(payload: Record<string, any> | null | undefined): string {
  const candidates = [payload?.email, payload?.contact_email, payload?.customer?.email, payload?.billing?.email]
  for (const candidate of candidates) {
    const email = typeof candidate === 'string' ? candidate.trim().toLowerCase() : ''
    if (EMAIL.test(email))
      return email
  }
  return ''
}

/** A store's decimal total as minor units: "19.99" is 1999, never 1998.9999. */
export function minorUnits(total: unknown): number {
  const value = Number(total)
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0
}

export interface Touch { source: 'campaign' | 'automation', id: number, sentAt: string }

/** Of two candidate touches, the later one; ties go to the campaign. */
export function lastTouch(campaign: Touch | null, automation: Touch | null): Touch | null {
  if (!campaign || !automation)
    return campaign ?? automation
  return new Date(automation.sentAt).getTime() > new Date(campaign.sentAt).getTime() ? automation : campaign
}

export function windowStart(occurredAt: string, days = ATTRIBUTION_WINDOW_DAYS): string {
  return new Date(new Date(occurredAt).getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

/** A stored time as ISO 8601: text in SQLite, a `Date` from Postgres. */
export function isoTime(value: unknown): string {
  const date = new Date(value as string)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function purchaseDedupeKey(commerceEventId: number): string {
  return `purchase:${commerceEventId}`
}

async function campaignTouch(teamId: number, email: string, from: string, until: string): Promise<Touch | null> {
  const row = await db.selectFrom('campaign_sends' as any)
    .select(['campaign_id', 'sent_at'] as any)
    .where('team_id' as any, '=', teamId)
    .where('channel' as any, '=', 'email')
    .where('recipient' as any, '=', email)
    .where('status' as any, 'in', ['sent', 'delivered'])
    .where('sent_at' as any, '>=', from)
    .where('sent_at' as any, '<=', until)
    .orderBy('sent_at' as any, 'desc')
    .executeTakeFirst() as { campaign_id: number, sent_at: string } | undefined
  return row ? { source: 'campaign', id: Number(row.campaign_id), sentAt: isoTime(row.sent_at) } : null
}

async function automationTouch(teamId: number, contactId: number, from: string, until: string): Promise<Touch | null> {
  const row = await (db as any).selectFrom('automation_step_runs')
    .innerJoin('automation_runs', 'automation_runs.id', '=', 'automation_step_runs.automation_run_id')
    .select(['automation_runs.automation_id as automation_id', 'automation_step_runs.completed_at as sent_at'])
    .where('automation_step_runs.team_id', '=', teamId)
    .where('automation_runs.team_id', '=', teamId)
    .where('automation_runs.subject_type', '=', 'contact')
    .where('automation_runs.subject_id', '=', String(contactId))
    .where('automation_step_runs.type', '=', 'send_email')
    .where('automation_step_runs.status', '=', 'completed')
    .where('automation_step_runs.completed_at', '>=', from)
    .where('automation_step_runs.completed_at', '<=', until)
    .orderBy('automation_step_runs.completed_at', 'desc')
    .executeTakeFirst() as { automation_id: number, sent_at: string } | undefined
  return row ? { source: 'automation', id: Number(row.automation_id), sentAt: isoTime(row.sent_at) } : null
}

export interface PurchaseOutcome { contactId: number | null, credited: Touch | null, started: number }

/**
 * Match, credit and trigger for one recorded commerce event. Never throws:
 * an order that cannot be credited is still recorded, and the webhook that
 * carried it is still processed.
 */
export async function recordPurchase(teamId: number, commerceEventId: number): Promise<PurchaseOutcome> {
  const outcome: PurchaseOutcome = { contactId: null, credited: null, started: 0 }
  try {
    const event = await db.selectFrom('commerce_events' as any)
      .select(['id', 'type', 'amount', 'currency', 'payload', 'occurred_at', 'contact_id'] as any)
      .where('id' as any, '=', commerceEventId)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst() as { id: number, type: string, amount: number | null, currency: string | null, payload: string, occurred_at: string, contact_id: number | null } | undefined
    if (!event)
      return outcome

    let payload: Record<string, any> = {}
    try {
      payload = JSON.parse(event.payload)
    }
    catch {}
    const email = buyerEmail(payload)
    if (!email)
      return outcome

    const contact = await db.selectFrom('contacts' as any).select(['id'] as any)
      .where('team_id' as any, '=', teamId).where('email' as any, '=', email)
      .executeTakeFirst() as { id: number } | undefined
    if (!contact)
      return outcome
    const contactId = Number(contact.id)
    outcome.contactId = contactId

    if (Number(event.contact_id) !== contactId) {
      await db.updateTable('commerce_events' as any).set({ contact_id: contactId, updated_at: new Date().toISOString() } as any)
        .where('id' as any, '=', event.id).where('team_id' as any, '=', teamId).execute()
    }

    if (event.type !== 'order_created')
      return outcome

    const occurredAt = Number.isNaN(new Date(event.occurred_at).getTime()) ? new Date().toISOString() : new Date(event.occurred_at).toISOString()
    const from = windowStart(occurredAt)
    const touch = lastTouch(await campaignTouch(teamId, email, from, occurredAt), await automationTouch(teamId, contactId, from, occurredAt))

    if (touch) {
      const now = new Date().toISOString()
      try {
        await db.insertInto('attribution_events' as any).values({
          team_id: teamId,
          uuid: randomUUID(),
          kind: 'purchase',
          source: touch.source,
          medium: 'email',
          campaign_key: `${touch.source}:${touch.id}`,
          campaign_id: touch.source === 'campaign' ? touch.id : null,
          contact_id: contactId,
          commerce_event_id: event.id,
          revenue: Math.max(0, Math.round(Number(event.amount) || 0)),
          currency: String(event.currency || 'USD').toUpperCase().slice(0, 3),
          dedupe_key: purchaseDedupeKey(event.id),
          occurred_at: occurredAt,
          created_at: now,
          updated_at: now,
        } as any).execute()
        outcome.credited = touch
      }
      catch (error) {
        // Already credited on an earlier pass: that is the rule, not a failure.
        if (!isUniqueViolation(error))
          throw error
      }
    }

    outcome.started = (await startAutomations(teamId, 'purchase_made', contactId)).length
  }
  catch (error) {
    log.error(`[commerce] could not attribute event ${commerceEventId} in team ${teamId}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return outcome
}
