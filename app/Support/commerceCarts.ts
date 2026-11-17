import { randomUUID } from 'node:crypto'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { isUniqueViolation } from '@stacksjs/orm'
import { startAutomations } from './automationRunner'
import { buyerEmail, isoTime, minorUnits } from './commerceAttribution'

/**
 * Carts a connected store reports, and when one counts as abandoned.
 *
 * Only Shopify sends carts: its `checkouts/create` and `checkouts/update`
 * webhooks carry the checkout's token, the shopper's email once they have
 * typed it, what is in it and a link back to it. WooCommerce has no cart
 * webhook, so its stores report orders only.
 *
 * A cart moves through four states:
 *
 * - `open`: the shopper was active within `CART_ABANDON_MINUTES`.
 * - `abandoned`: quiet for that long with no order. `abandonQuietCarts`,
 *   run every few minutes by the scheduler, moves it here and starts the
 *   automations waiting for `cart_abandoned`.
 * - `completed`: an order arrived for it while it was still open.
 * - `recovered`: an order arrived for it after it was abandoned.
 *
 * An order closes the cart whose token it names, or failing that the
 * buyer's most recent open or abandoned cart from the same store within
 * `CART_RECOVERY_DAYS`. A closed cart is never reopened.
 *
 * As with orders, no contact is created. A cart from an address that is not
 * a contact is counted and starts nothing.
 */
export const CART_ABANDON_MINUTES = 60

/**
 * A cart found quiet for longer than this, say after the scheduler was
 * down for a day, is still marked abandoned but starts nothing: a reminder
 * that late reads as a mistake.
 */
export const CART_TRIGGER_MAX_HOURS = 24

export const CART_RECOVERY_DAYS = 7

/** The most carts one pass looks at, so a backlog is worked through a batch at a time. */
export const CART_BATCH = 500

export const CART_STATUSES = ['open', 'abandoned', 'completed', 'recovered'] as const

export interface CheckoutCart {
  token: string
  email: string
  recoveryUrl: string | null
  amount: number
  currency: string
  itemCount: number
  activityAt: string
  completed: boolean
}

/** The link back to the cart, only when it is an https address. */
export function recoveryLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048)
    return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.toString() : null
  }
  catch {
    return null
  }
}

/** A Shopify checkout as a cart, or null when it carries no token. */
export function cartFromCheckout(payload: Record<string, any> | null | undefined): CheckoutCart | null {
  const token = String(payload?.token ?? '').trim()
  if (!token || token.length > 255)
    return null
  const items = Array.isArray(payload?.line_items) ? payload.line_items : []
  const itemCount = items.reduce((sum: number, item: any) => sum + Math.max(0, Math.floor(Number(item?.quantity) || 0)), 0)
  const activityAt = isoTime(payload?.updated_at) || isoTime(payload?.created_at) || new Date().toISOString()
  return {
    token,
    email: buyerEmail(payload),
    recoveryUrl: recoveryLink(payload?.abandoned_checkout_url),
    amount: minorUnits(payload?.total_price ?? payload?.subtotal_price),
    currency: String(payload?.currency || payload?.presentment_currency || 'USD').toUpperCase().slice(0, 3),
    itemCount,
    activityAt,
    completed: Boolean(payload?.completed_at),
  }
}

/** The status a cart takes when its order arrives. */
export function closedStatus(current: string): 'completed' | 'recovered' {
  return current === 'abandoned' ? 'recovered' : 'completed'
}

/** The latest of two stored times, so an out-of-order webhook cannot move a cart back. */
export function laterTime(a: unknown, b: unknown): string {
  const first = isoTime(a)
  const second = isoTime(b)
  if (!first || !second)
    return first || second || new Date().toISOString()
  return new Date(first).getTime() >= new Date(second).getTime() ? first : second
}

interface CartRow { id: number, status: string, last_activity_at: unknown, contact_id: number | null }

async function contactFor(teamId: number, email: string): Promise<number | null> {
  if (!email)
    return null
  const row = await db.selectFrom('contacts' as any).select(['id'] as any)
    .where('team_id' as any, '=', teamId).where('email' as any, '=', email)
    .executeTakeFirst() as { id: number } | undefined
  return row ? Number(row.id) : null
}

async function cartByToken(connectionId: number, token: string): Promise<CartRow | undefined> {
  return await db.selectFrom('commerce_carts' as any)
    .select(['id', 'status', 'last_activity_at', 'contact_id'] as any)
    .where('commerce_connection_id' as any, '=', connectionId)
    .where('external_id' as any, '=', token)
    .executeTakeFirst() as CartRow | undefined
}

/** Write what a checkout webhook says about its cart. */
export async function recordCheckout(teamId: number, connectionId: number, payload: Record<string, any>): Promise<{ cartId: number, status: string } | null> {
  const cart = cartFromCheckout(payload)
  if (!cart)
    return null
  const contactId = await contactFor(teamId, cart.email)
  const now = new Date().toISOString()

  let existing = await cartByToken(connectionId, cart.token)
  if (!existing) {
    try {
      await db.insertInto('commerce_carts' as any).values({
        team_id: teamId,
        commerce_connection_id: connectionId,
        contact_id: contactId,
        uuid: randomUUID(),
        external_id: cart.token,
        status: cart.completed ? 'completed' : 'open',
        email: cart.email || null,
        recovery_url: cart.recoveryUrl,
        amount: cart.amount,
        currency: cart.currency,
        item_count: cart.itemCount,
        last_activity_at: cart.activityAt,
        closed_at: cart.completed ? now : null,
        created_at: now,
        updated_at: now,
      } as any).execute()
      const created = await cartByToken(connectionId, cart.token)
      return created ? { cartId: Number(created.id), status: String(created.status) } : null
    }
    catch (error) {
      // Two deliveries for one new checkout: the other one wrote it first.
      if (!isUniqueViolation(error))
        throw error
      existing = await cartByToken(connectionId, cart.token)
      if (!existing)
        throw error
    }
  }

  if (existing.status === 'completed' || existing.status === 'recovered')
    return { cartId: Number(existing.id), status: existing.status }

  const status = cart.completed ? closedStatus(existing.status) : existing.status
  await db.updateTable('commerce_carts' as any).set({
    contact_id: contactId ?? existing.contact_id,
    status,
    ...(cart.email ? { email: cart.email } : {}),
    ...(cart.recoveryUrl ? { recovery_url: cart.recoveryUrl } : {}),
    amount: cart.amount,
    currency: cart.currency,
    item_count: cart.itemCount,
    last_activity_at: laterTime(existing.last_activity_at, cart.activityAt),
    ...(cart.completed ? { closed_at: now } : {}),
    updated_at: now,
  } as any).where('id' as any, '=', existing.id).where('status' as any, '=', existing.status).execute()
  return { cartId: Number(existing.id), status }
}

/**
 * Close the cart an order came from. Never throws: an order is recorded
 * whether or not its cart is found.
 */
export async function closeCartForOrder(teamId: number, connectionId: number, payload: Record<string, any>, now: Date = new Date()): Promise<{ cartId: number, status: string } | null> {
  try {
    const token = String(payload?.checkout_token ?? '').trim()
    let cart = token ? await cartByToken(connectionId, token) : undefined
    if (cart && cart.status !== 'open' && cart.status !== 'abandoned')
      return null

    if (!cart) {
      const email = buyerEmail(payload)
      if (!email)
        return null
      const since = new Date(now.getTime() - CART_RECOVERY_DAYS * 24 * 60 * 60 * 1000).toISOString()
      cart = await db.selectFrom('commerce_carts' as any)
        .select(['id', 'status', 'last_activity_at', 'contact_id'] as any)
        .where('team_id' as any, '=', teamId)
        .where('commerce_connection_id' as any, '=', connectionId)
        .where('email' as any, '=', email)
        .where('status' as any, 'in', ['open', 'abandoned'])
        .where('last_activity_at' as any, '>=', since)
        .orderBy('last_activity_at' as any, 'desc')
        .executeTakeFirst() as CartRow | undefined
      if (!cart)
        return null
    }

    const status = closedStatus(cart.status)
    const result = await db.updateTable('commerce_carts' as any)
      .set({ status, closed_at: now.toISOString(), updated_at: now.toISOString() } as any)
      .where('id' as any, '=', cart.id).where('team_id' as any, '=', teamId)
      .where('status' as any, '=', cart.status)
      .executeTakeFirst() as { numUpdatedRows?: bigint | number }
    return Number(result?.numUpdatedRows ?? 0) === 1 ? { cartId: Number(cart.id), status } : null
  }
  catch (error) {
    log.error(`[commerce] could not close the cart for an order in team ${teamId}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/** Whether a cart is worth a reminder: it holds something and there is a way back to it. */
export function remindable(cart: { amount: unknown, item_count: unknown, recovery_url: unknown }): boolean {
  return (Number(cart.amount) > 0 || Number(cart.item_count) > 0) && recoveryLink(cart.recovery_url) !== null
}

export interface AbandonOutcome { abandoned: number, started: number }

/**
 * Mark every cart quiet for `CART_ABANDON_MINUTES` as abandoned, across all
 * workspaces, and start cart automations for the ones that qualify. Each
 * cart is claimed by moving it from `open`, so two passes at once cannot
 * both start a run for it.
 */
export async function abandonQuietCarts(now: Date = new Date()): Promise<AbandonOutcome> {
  const outcome: AbandonOutcome = { abandoned: 0, started: 0 }
  const cutoff = new Date(now.getTime() - CART_ABANDON_MINUTES * 60_000).toISOString()
  const freshest = now.getTime() - CART_TRIGGER_MAX_HOURS * 60 * 60 * 1000

  const carts = await db.selectFrom('commerce_carts' as any)
    .select(['id', 'team_id', 'contact_id', 'amount', 'item_count', 'recovery_url', 'last_activity_at'] as any)
    .where('status' as any, '=', 'open')
    .where('last_activity_at' as any, '<=', cutoff)
    .orderBy('last_activity_at' as any, 'asc')
    .limit(CART_BATCH)
    .execute() as unknown as Array<{ id: number, team_id: number, contact_id: number | null, amount: number | null, item_count: number | null, recovery_url: string | null, last_activity_at: unknown }>

  for (const cart of carts) {
    const claimed = await db.updateTable('commerce_carts' as any)
      .set({ status: 'abandoned', abandoned_at: now.toISOString(), updated_at: now.toISOString() } as any)
      .where('id' as any, '=', cart.id).where('status' as any, '=', 'open')
      .executeTakeFirst() as { numUpdatedRows?: bigint | number }
    if (Number(claimed?.numUpdatedRows ?? 0) !== 1)
      continue
    outcome.abandoned++

    const quietSince = new Date(isoTime(cart.last_activity_at)).getTime()
    if (!cart.contact_id || !remindable(cart) || !(quietSince >= freshest))
      continue
    const started = await startAutomations(Number(cart.team_id), 'cart_abandoned', Number(cart.contact_id), { key: `cart:${cart.id}`, context: { cartId: Number(cart.id) } })
    outcome.started += started.length
  }
  return outcome
}

/** The cart a run was started for, as the runner needs it. */
export async function runCart(teamId: number, cartId: number): Promise<{ status: string, recoveryUrl: string | null } | null> {
  const row = await db.selectFrom('commerce_carts' as any).select(['status', 'recovery_url'] as any)
    .where('id' as any, '=', cartId).where('team_id' as any, '=', teamId)
    .executeTakeFirst() as { status: string, recovery_url: string | null } | undefined
  return row ? { status: String(row.status), recoveryUrl: recoveryLink(row.recovery_url) } : null
}
