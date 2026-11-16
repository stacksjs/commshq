/**
 * What an order leads to: the buyer matched, the order credited, a purchase
 * automation started.
 *
 * The rules that matter: a purchase never creates a contact (buying is not
 * consent); credit goes to the last email the buyer was actually sent, in
 * a fixed window, once per order; money stays in its own currency; and a
 * failure here never fails the webhook that carried the order.
 */
import { describe, expect, test } from 'bun:test'
import { TRIGGER_TYPES } from '../../app/Support/automationGraph'
import { ATTRIBUTION_WINDOW_DAYS, buyerEmail, lastTouch, minorUnits, purchaseDedupeKey, windowStart } from '../../app/Support/commerceAttribution'
import { moneyList, toAnalyticsView, toRevenueView } from '../../resources/data/analytics-query'
import { automationPayload, TRIGGERS, triggerLabel } from '../../resources/data/automations-query'
import { toEventView } from '../../resources/data/commerce-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

describe('the buyer', () => {
  test('the email is read from where each store puts it', () => {
    expect(buyerEmail({ email: ' Buyer@Example.com ' })).toBe('buyer@example.com')
    expect(buyerEmail({ contact_email: 'a@example.com' })).toBe('a@example.com')
    expect(buyerEmail({ customer: { email: 'shopify@example.com' } })).toBe('shopify@example.com')
    expect(buyerEmail({ billing: { email: 'woo@example.com' } })).toBe('woo@example.com')
    expect(buyerEmail({ email: 'not an email', billing: { email: 'woo@example.com' } })).toBe('woo@example.com')
    for (const payload of [{}, null, undefined, { email: 42 }, { email: '' }])
      expect(buyerEmail(payload as any)).toBe('')
  })

  test('a purchase is matched to a contact, never creates one', async () => {
    const code = await source('app/Support/commerceAttribution.ts')
    expect(code).toContain(".where('team_id' as any, '=', teamId).where('email' as any, '=', email)")
    expect(code).not.toMatch(/insertInto\('contacts'|Contact\.(create|forceCreate)/)
    expect(code).toContain('if (!contact)\n      return outcome')
  })
})

describe('the credit', () => {
  test('store totals become minor units without float drift', () => {
    expect([minorUnits('19.99'), minorUnits(42.5), minorUnits('0.1'), minorUnits('1234.565')]).toEqual([1999, 4250, 10, 123457])
    for (const value of [undefined, null, '', 'free', -5, 0])
      expect(minorUnits(value)).toBe(0)
    expect(source('app/Jobs/ProcessWebhookEvent.ts')).resolves.toContain('amount: minorUnits(payload.total_price ?? payload.total),')
  })

  test('the window is a fixed number of days before the order', () => {
    expect(ATTRIBUTION_WINDOW_DAYS).toBe(5)
    expect(windowStart('2026-11-16T12:00:00.000Z')).toBe('2026-11-11T12:00:00.000Z')
  })

  test('the later of the campaign and the automation touch wins', () => {
    const campaign = { source: 'campaign' as const, id: 1, sentAt: '2026-11-14T09:00:00.000Z' }
    const automation = { source: 'automation' as const, id: 7, sentAt: '2026-11-15T09:00:00.000Z' }
    expect(lastTouch(campaign, automation)).toBe(automation)
    expect(lastTouch({ ...campaign, sentAt: '2026-11-16T00:00:00.000Z' }, automation)?.source).toBe('campaign')
    expect(lastTouch(campaign, { ...automation, sentAt: campaign.sentAt })?.source).toBe('campaign')
    expect(lastTouch(null, automation)).toBe(automation)
    expect(lastTouch(null, null)).toBeNull()
  })

  test('only an order credits, once, and only email that was really sent counts', async () => {
    const code = await source('app/Support/commerceAttribution.ts')
    expect(code).toContain("if (event.type !== 'order_created')\n      return outcome")
    expect(code).toContain(".where('status' as any, 'in', ['sent', 'delivered'])")
    expect(code).toContain(".where('automation_step_runs.status', '=', 'completed')")
    expect(code).toContain("dedupe_key: purchaseDedupeKey(event.id),")
    expect(purchaseDedupeKey(42)).toBe('purchase:42')
    // The touch must come before the order, inside the window.
    expect(code).toContain(".where('sent_at' as any, '<=', until)")
    expect(code).toContain(".where('automation_step_runs.completed_at', '<=', until)")
  })

  test('every query is scoped to the team, and a failure never fails the webhook', async () => {
    const code = await source('app/Support/commerceAttribution.ts')
    const queries = code.match(/selectFrom\(|updateTable\(/g)?.length ?? 0
    const scoped = code.match(/where\('(?:automation_step_runs\.)?team_id'(?: as any)?, '=', teamId\)/g)?.length ?? 0
    expect(scoped).toBeGreaterThanOrEqual(queries)
    const body = code.slice(code.indexOf('export async function recordPurchase'))
    expect(body.indexOf('try {')).toBeLessThan(body.indexOf('selectFrom'))
    expect(body).toContain('log.error(`[commerce] could not attribute event')
    // Run on every pass, so a retry finishes what a crashed pass started.
    expect(await source('app/Jobs/ProcessWebhookEvent.ts')).toContain('await recordPurchase(input.teamId, Number(recorded.id))')
  })
})

describe('the purchase trigger', () => {
  test('the page offers exactly the triggers the server fires', () => {
    expect(TRIGGERS.map(trigger => trigger.value)).toEqual([...TRIGGER_TYPES])
    expect(triggerLabel({ type: 'purchase_made' })).toBe('When a contact places an order')
    expect(JSON.parse(automationPayload({ name: 'Thanks', trigger: 'purchase_made' }).trigger)).toEqual({ type: 'purchase_made' })
    expect(JSON.parse(automationPayload({ name: 'Thanks', trigger: 'made_up' }).trigger)).toEqual({ type: 'subscriber_joined' })
  })

  test('a known buyer\'s order starts purchase automations', async () => {
    expect(await source('app/Support/commerceAttribution.ts')).toContain("await startAutomations(teamId, 'purchase_made', contactId)")
  })
})

describe('what the pages show', () => {
  test('money is listed per currency, largest first, never summed across them', () => {
    expect(moneyList([{ currency: 'eur', amount: 8000 }, { currency: 'USD', amount: 124000 }])).toBe('$1,240.00 and €80.00')
    expect(moneyList([{ currency: 'USD', amount: 500 }])).toBe('$5.00')
    expect(moneyList([{ currency: 'USD', amount: 0 }])).toBe('')
    expect(moneyList(null)).toBe('')
  })

  test('the revenue section says what came in and what an email is credited with', () => {
    const view = toRevenueView({
      orders: { count: 12, revenue: [{ currency: 'USD', amount: 124000 }], fromContacts: 9 },
      refunds: { count: 1, amount: [{ currency: 'USD', amount: 2000 }] },
      credited: { orders: 4, revenue: [{ currency: 'USD', amount: 40000 }], bySource: [{ source: 'campaign', id: 3, name: 'November issue', orders: 3, revenue: [{ currency: 'USD', amount: 30000 }] }, { source: 'automation', id: 5, name: null, orders: 1, revenue: [{ currency: 'USD', amount: 10000 }] }] },
      windowDays: 5,
    }, 'Last 30 days')
    expect(view).toMatchObject({
      hasOrders: true,
      ordersLine: '12 orders worth $1,240.00.',
      contactsLine: '9 of them from people who are already contacts.',
      refundsLine: '1 refund of $20.00.',
      creditedLine: '4 orders worth $400.00 credited to an email.',
    })
    expect(view.windowNote).toContain('in the 5 days before it')
    expect(view.sources).toEqual([
      { key: 'campaign:3', label: 'Campaign: November issue', href: '/dashboard/commshq/campaigns', ordersLabel: '3 orders', revenueLabel: '$300.00' },
      { key: 'automation:5', label: 'Automation: An automation that was deleted', href: '/dashboard/commshq/automations', ordersLabel: '1 order', revenueLabel: '$100.00' },
    ])
  })

  test('a workspace with no store has an empty revenue section, not zeros dressed as figures', () => {
    const view = toAnalyticsView({ data: { days: 7 } }).revenue
    expect(view).toMatchObject({ hasOrders: false, ordersLine: 'No orders came in during the last 7 days.', sources: [] })
  })

  test('an event says whether the buyer is a contact, and never who', () => {
    expect(toEventView({ id: 1, contact_id: 4 }).buyerLabel).toBe('Buyer is a contact')
    expect(toEventView({ id: 1, contact_id: null }).buyerLabel).toBe('Buyer is not a contact')
  })
})
