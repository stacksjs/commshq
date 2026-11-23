/**
 * Carts a store reports, when one counts as abandoned, and what a cart
 * automation does with it.
 *
 * The rules that matter: only an https link back to a cart is kept; a cart
 * is abandoned after an hour without an order, and starts nothing once it
 * is a day old; a cart never creates a contact; one run per cart, never two
 * at once for a shopper; a run stops when the cart is bought; and the
 * shopper's address and cart link never reach the page.
 */
import { describe, expect, test } from 'bun:test'
import { contextCartId } from '../../app/Jobs/ProcessAutomationRun'
import { CART_LINK_LABEL, runIdempotencyKey, TRIGGER_TYPES, withCartLink, withSmsCartLink } from '../../app/Support/automationGraph'
import { CART_ABANDON_MINUTES, CART_STATUSES, CART_TRIGGER_MAX_HOURS, cartFromCheckout, closedStatus, laterTime, recoveryLink, remindable } from '../../app/Support/commerceCarts'
import { cartsLine, toRevenueView } from '../../resources/data/analytics-query'
import { triggerLabel, turnOnNote } from '../../resources/data/automations-query'
import { CART_STATES, cartsNote, cartsUrl, toCartView } from '../../resources/data/commerce-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

const CHECKOUT = {
  token: 'c1a2b3',
  email: ' Shopper@Example.com ',
  abandoned_checkout_url: 'https://shop.example/checkouts/c1a2b3/recover?key=k',
  total_price: '19.99',
  currency: 'eur',
  line_items: [{ quantity: 2 }, { quantity: 1 }, { quantity: 'x' }],
  updated_at: '2026-11-16T10:30:00-05:00',
  completed_at: null,
}

describe('a checkout as a cart', () => {
  test('what is read from it', () => {
    expect(cartFromCheckout(CHECKOUT)).toEqual({
      token: 'c1a2b3',
      email: 'shopper@example.com',
      recoveryUrl: 'https://shop.example/checkouts/c1a2b3/recover?key=k',
      amount: 1999,
      currency: 'EUR',
      itemCount: 3,
      activityAt: '2026-11-16T15:30:00.000Z',
      completed: false,
    })
    expect(cartFromCheckout({ ...CHECKOUT, completed_at: '2026-11-16T15:40:00Z' })?.completed).toBe(true)
  })

  test('no token is no cart', () => {
    for (const payload of [{}, null, undefined, { ...CHECKOUT, token: '' }, { ...CHECKOUT, token: 'x'.repeat(256) }])
      expect(cartFromCheckout(payload as any)).toBeNull()
  })

  test('only an https link back is kept', () => {
    expect(recoveryLink('https://shop.example/r')).toBe('https://shop.example/r')
    for (const value of ['http://shop.example/r', 'javascript:alert(1)', 'not a url', '', 42, null, `https://shop.example/${'x'.repeat(2048)}`])
      expect(recoveryLink(value)).toBeNull()
  })

  test('an order closes an open cart as bought, an abandoned one as recovered', () => {
    expect(closedStatus('open')).toBe('completed')
    expect(closedStatus('abandoned')).toBe('recovered')
  })

  test('a late webhook cannot move a cart back in time', () => {
    expect(laterTime('2026-11-16T10:00:00Z', '2026-11-16T09:00:00Z')).toBe('2026-11-16T10:00:00.000Z')
    expect(laterTime(new Date('2026-11-16T08:00:00Z'), '2026-11-16T09:00:00Z')).toBe('2026-11-16T09:00:00.000Z')
    expect(laterTime('', '2026-11-16T09:00:00Z')).toBe('2026-11-16T09:00:00.000Z')
  })

  test('a reminder needs something in the cart and a way back to it', () => {
    expect(remindable({ amount: 1999, item_count: 0, recovery_url: 'https://shop.example/r' })).toBe(true)
    expect(remindable({ amount: 0, item_count: 2, recovery_url: 'https://shop.example/r' })).toBe(true)
    expect(remindable({ amount: 0, item_count: 0, recovery_url: 'https://shop.example/r' })).toBe(false)
    expect(remindable({ amount: 1999, item_count: 1, recovery_url: null })).toBe(false)
  })

  test('the windows', () => {
    expect(CART_ABANDON_MINUTES).toBe(60)
    expect(CART_TRIGGER_MAX_HOURS).toBe(24)
  })
})

describe('the rules in the code', () => {
  test('a cart never creates a contact, and its address and link stay off the API', async () => {
    const carts = await source('app/Support/commerceCarts.ts')
    expect(carts).not.toMatch(/insertInto\('contacts'|Contact\.(create|forceCreate)/)
    const model = await source('app/Models/CommerceCart.ts')
    expect(model).toMatch(/email: \{[^}]*hidden: true/)
    expect(model).toMatch(/recoveryUrl: \{[^}]*hidden: true/)
  })

  test('each cart is claimed before it starts anything, so two passes cannot both start it', async () => {
    const carts = await source('app/Support/commerceCarts.ts')
    expect(carts).toContain(".set({ status: 'abandoned', abandoned_at: now.toISOString(), updated_at: now.toISOString() } as any)\n      .where('id' as any, '=', cart.id).where('status' as any, '=', 'open')")
    expect(carts).toContain("startAutomations(Number(cart.team_id), 'cart_abandoned', Number(cart.contact_id), { key: `cart:${cart.id}`, context: { cartId: Number(cart.id) } })")
  })

  test('one run per cart, and never two at once for one shopper', async () => {
    expect(runIdempotencyKey(4, 'cart_abandoned', 91, 'cart:12')).toBe('automation:4:cart_abandoned:contact:91:cart:12')
    expect(runIdempotencyKey(4, 'subscriber_joined', 91)).toBe('automation:4:subscriber_joined:contact:91')
    const runner = await source('app/Support/automationRunner.ts')
    expect(runner).toContain(".where('status' as any, 'in', UNFINISHED)")
    expect(runner).toContain("const UNFINISHED = ['queued', 'running', 'waiting']")
  })

  test('nobody is enrolled into a cart automation on turning it on', async () => {
    const runner = await source('app/Support/automationRunner.ts')
    expect(runner).toContain("else if (trigger === 'cart_abandoned') {\n    // None: a cart abandoned before the automation existed is days old,\n    // and a reminder for it would read as a mistake.\n    return []")
  })

  test('a run stops when its cart is bought', async () => {
    const job = await source('app/Jobs/ProcessAutomationRun.ts')
    expect(job).toContain("if (!cart || cart.status === 'completed' || cart.status === 'recovered') {")
    expect(contextCartId(JSON.stringify({ trigger: 'cart_abandoned', cartId: 12 }))).toBe(12)
    expect(contextCartId({ cartId: '7' })).toBe(7)
    for (const value of [null, '', 'nope', '{}', { cartId: -1 }, { cartId: 1.5 }])
      expect(contextCartId(value)).toBe(0)
  })

  test('the scheduler looks for quiet carts', async () => {
    expect(await source('app/Scheduler.ts')).toContain("schedule\n    .job('AbandonQuietCarts')\n    .everyFiveMinutes()")
  })

  test('an order closes its cart before attribution runs', async () => {
    const job = await source('app/Jobs/ProcessWebhookEvent.ts')
    expect(job).toContain("if (type === 'order_created')\n            await closeCartForOrder(input.teamId, Number(connection.id), payload)\n          await recordPurchase(")
    expect(job).toContain("if (type === 'cart') {\n          await recordCheckout(input.teamId, Number(connection.id), payload)")
  })
})

describe('the email', () => {
  test('ends with the link back, escaped', () => {
    const { html, text } = withCartLink('<p>Still thinking?</p>', 'Still thinking?', 'https://shop.example/r?a=1&b="2"')
    expect(html).toBe('<p>Still thinking?</p>\n<p><a href="https://shop.example/r?a=1&amp;b=&quot;2&quot;">Return to your cart</a></p>')
    expect(text).toBe(`Still thinking?\n\n${CART_LINK_LABEL}: https://shop.example/r?a=1&b="2"`)
  })

  test('is unchanged with no cart', () => {
    expect(withCartLink('<p>Hi</p>', 'Hi', null)).toEqual({ html: '<p>Hi</p>', text: 'Hi' })
  })
})

describe('the text', () => {
  test('ends with the link back, on a line of its own', () => {
    expect(withSmsCartLink(' Still thinking? ', 'https://shop.example/r?a=1')).toBe(`Still thinking?\n${CART_LINK_LABEL}: https://shop.example/r?a=1`)
  })

  test('is unchanged with no cart', () => {
    expect(withSmsCartLink('Hi', null)).toBe('Hi')
  })

  test('is sent, and counted against the allowance, with the link in it', async () => {
    const job = await Bun.file(new URL('../../app/Jobs/ProcessAutomationRun.ts', import.meta.url)).text()
    expect(job).toContain('const body = withSmsCartLink(step.config.body, cartUrl)')
    expect(job).toContain('const segments = estimateSmsSegments(body).segments')
    expect(job).toContain('const result = await sendSms({ to: phone, body,')
    expect(job).not.toContain('body: step.config.body')
  })

  test('the editor says the line is added, only for a cart automation', async () => {
    const builder = await Bun.file(new URL('../../resources/components/CommsHQ/AutomationBuilder.stx', import.meta.url)).text()
    expect(builder).toContain("editTrigger() === 'cart_abandoned' ? ' A line linking back to the cart is added at the end.' : ''")
  })
})

describe('the pages', () => {
  test('the trigger is offered and named', () => {
    expect(TRIGGER_TYPES).toContain('cart_abandoned')
    expect(triggerLabel({ type: 'cart_abandoned' })).toBe('When a contact leaves a cart')
  })

  test('the confirmation only mentions including people when that is offered', () => {
    expect(turnOnNote(true)).toContain('the other choice includes them')
    expect(turnOnNote(false)).toBe('From now on, everyone its trigger catches gets these messages.')
  })

  test('the page names the same cart states as the server', () => {
    expect(CART_STATES.map(item => item.value).sort()).toEqual([...CART_STATUSES].sort())
  })

  test('a cart shows its state, size and whether the shopper is a contact, not who', () => {
    const view = toCartView({ id: 3, status: 'recovered', amount: 1999, currency: 'USD', item_count: 3, contact_id: 9, last_activity_at: '2026-11-16T10:00:00Z' })
    expect(view).toMatchObject({ stateLabel: 'Recovered', amountLabel: '$19.99', itemsLabel: '3 items', shopperLabel: 'Shopper is a contact' })
    expect(toCartView({ id: 4, status: 'completed', item_count: 1 })).toMatchObject({ stateLabel: 'Bought', amountLabel: '', itemsLabel: '1 item', shopperLabel: 'Shopper is not a contact' })
  })

  test('the list asks for the latest carts, in a known state only', () => {
    expect(cartsUrl()).toBe('/api/v1/commerce-carts?per_page=10&sort=-last_activity_at%2C-id')
    expect(cartsUrl('abandoned')).toBe('/api/v1/commerce-carts?per_page=10&status=abandoned&sort=-last_activity_at%2C-id')
    expect(cartsUrl('nonsense')).toBe(cartsUrl())
  })

  test('each store says what its carts come to, or why it has none', () => {
    expect(cartsNote({ id: 1, provider: 'shopify', carts: { open: 2, abandoned: '5', recovered: 1, completed: 0 } })).toBe('Carts: 2 open, 5 abandoned, 1 recovered.')
    expect(cartsNote({ id: 1, provider: 'shopify' })).toBe('No carts yet. They arrive with the checkout webhooks.')
    expect(cartsNote({ id: 2, provider: 'woocommerce' })).toBe('WooCommerce does not send carts, so only its orders are read.')
  })
})

describe('the analytics page', () => {
  test('carts in one sentence, never as a rate', () => {
    expect(cartsLine(0, 0, '')).toBe('')
    expect(cartsLine(12, 0, '')).toBe('12 carts abandoned, none recovered.')
    expect(cartsLine(1, 3, '$120.00')).toBe('1 cart abandoned, 3 recovered, worth $120.00.')
    expect(cartsLine(0, 2, '')).toBe('No cart was abandoned, 2 recovered.')
    expect(cartsLine(12, 3, '$1.00')).not.toMatch(/%/)
  })

  test('the revenue section reads the server\'s cart counts, per currency', () => {
    const view = toRevenueView({ carts: { abandoned: '4', recovered: '2', recoveredValue: [{ currency: 'USD', amount: '5000', count: '1' }, { currency: 'EUR', amount: 2000, count: 1 }] } }, 'Last 30 days')
    expect(view.hasOrders).toBe(true)
    expect(view.cartsLine).toBe('4 carts abandoned, 2 recovered, worth $50.00 and €20.00.')
    expect(toRevenueView({}, 'Last 30 days')).toMatchObject({ hasOrders: false, cartsLine: '' })
  })

  test('the server counts carts abandoned and recovered in the period', async () => {
    const code = await source('app/Support/workspaceAnalytics.ts')
    expect(code).toContain("(db as any).selectFrom('commerce_carts').where('team_id', '=', teamId).where('abandoned_at', '>=', since).count()")
    expect(code).toContain(".where('team_id', '=', teamId).where('status', '=', 'recovered').where('closed_at', '>=', since)")
  })
})
