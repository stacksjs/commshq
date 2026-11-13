/**
 * Connected stores and the events they send.
 *
 * The rules that matter: a store's signing secret goes in and never comes
 * out; only an admin or owner connects, pauses or re-keys a store; a
 * provider's webhook is authenticated by its signature, so the route must
 * not also demand a CSRF token it can never have; and the page claims only
 * what the processing job really writes.
 */
import { describe, expect, test } from 'bun:test'
import {
  canManageCommerce,
  normalizeStoreName,
  normalizeStoreSecret,
  STORE_NAME_MAX as SERVER_NAME_MAX,
  STORE_NAME_MIN as SERVER_NAME_MIN,
  STORE_PROVIDERS as SERVER_PROVIDERS,
  STORE_STATUS_ENDPOINT,
  storeProvider,
  webhookPath,
} from '../../app/Support/commerceStores'
import { CREDENTIAL_MAX, CREDENTIAL_MIN } from '../../app/Support/integrationConnectors'
import {
  connectError,
  connectPayload,
  EVENT_TYPES,
  EVENTS_ENDPOINT,
  EVENTS_PER_PAGE,
  eventsUrl,
  formatAmount,
  listErrorMessage,
  NOT_USED_YET,
  saveErrorMessage,
  SECRET_MAX,
  SECRET_MIN,
  secretError,
  STORE_NAME_MAX,
  STORE_NAME_MIN,
  STORE_PROVIDERS,
  STORES_ENDPOINT,
  storeUrl,
  toEventView,
  toStoresView,
  toStoreView,
} from '../../resources/data/commerce-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

const ACTIONS = ['ListStoresAction', 'ConnectStoreAction', 'UpdateStoreAction']

describe('the routes', () => {
  test('stores are served by the app actions, behind auth and team', async () => {
    const routes = await source('routes/api.ts')
    expect(STORES_ENDPOINT).toBe('/api/v1/commerce/stores')
    expect(routes).toContain("route.get('/v1/commerce/stores', 'Actions/Api/V1/Commerce/ListStoresAction').middleware('auth').middleware('team')")
    expect(routes).toContain("route.post('/v1/commerce/stores', 'Actions/Api/V1/Commerce/ConnectStoreAction').middleware('auth').middleware('team').rateLimit(10, 'minute')")
    expect(routes).toContain("route.patch('/v1/commerce/stores/{id}', 'Actions/Api/V1/Commerce/UpdateStoreAction').middleware('auth').middleware('team').rateLimit(20, 'minute')")
    expect(storeUrl(4)).toBe('/api/v1/commerce/stores/4')
  })

  test('a provider webhook is not asked for a CSRF token', async () => {
    // It carries no CommsHQ cookie, so the check refused every webhook with a
    // 403 before the signature was ever looked at.
    expect(await source('routes/api.ts')).toContain("route.post('/webhooks/{provider}/{endpoint}', 'Actions/Webhooks/IngestWebhookAction').skipCsrf().rateLimit(300, 'minute')")
    const ingest = await source('app/Actions/Webhooks/IngestWebhookAction.ts')
    expect(ingest).toContain("return response.json({ error: 'Invalid webhook signature' }, 401)")
  })

  test('the generated APIs can no longer create or change a connection or an endpoint', async () => {
    // An endpoint made there has no secret, and a connection set active there
    // has no endpoint behind it.
    expect(await source('app/Models/CommerceConnection.ts')).toContain("uri: 'commerce-connections', routes: ['index', 'show']")
    expect(await source('app/Models/WebhookEndpoint.ts')).toContain("uri: 'webhook-endpoints', routes: ['index', 'show']")
  })

  test('events are read newest first from the generated list', async () => {
    expect(EVENTS_ENDPOINT).toBe('/api/v1/commerce-events')
    expect(params(eventsUrl())).toEqual({ per_page: String(EVENTS_PER_PAGE), sort: '-occurred_at,-id' })
    expect(params(eventsUrl({ page: 2, type: 'order_refunded' }))).toMatchObject({ page: '2', type: 'order_refunded' })
    expect(await source('app/Models/CommerceEvent.ts')).toContain("uri: 'commerce-events', routes: ['index', 'show'], middleware: ['auth', 'team']")
  })
})

describe('the server rules', () => {
  test('every action is scoped to the caller\'s team', async () => {
    for (const action of ACTIONS) {
      const code = await source(`app/Actions/Api/V1/Commerce/${action}.ts`)
      expect(code).toContain('await activeTeam(request)')
      expect(code).toContain("if (!teamId")
      expect(code).toMatch(/where\('team_id'( as any)?, '=', teamId\)/)
    }
    expect(await source('app/Support/commerceStores.ts')).toContain(".where('team_id' as any, '=', teamId)")
  })

  test('only an admin or owner connects or changes a store', async () => {
    for (const role of ['owner', 'admin', 'Owner', 'ADMIN'])
      expect(canManageCommerce(role)).toBe(true)
    for (const role of ['member', 'viewer', '', null, undefined])
      expect(canManageCommerce(role)).toBe(false)
    for (const action of ['ConnectStoreAction', 'UpdateStoreAction'])
      expect(await source(`app/Actions/Api/V1/Commerce/${action}.ts`)).toContain('if (!canManageCommerce(membership?.role)) return response.json(')
  })

  test('the secret is written through the encrypting write and never returned or logged', async () => {
    const connect = await source('app/Actions/Api/V1/Commerce/ConnectStoreAction.ts')
    const update = await source('app/Actions/Api/V1/Commerce/UpdateStoreAction.ts')
    const list = await source('app/Actions/Api/V1/Commerce/ListStoresAction.ts')
    expect(connect).toContain('WebhookEndpoint.forceCreate({')
    expect(connect).toContain('encryptedSecret: secret,')
    expect(update).toContain('WebhookEndpoint.forceUpdate(endpoint.id, { encryptedSecret: secret }')
    // Nothing that answers or audits mentions the secret's value.
    for (const code of [connect, update]) {
      for (const line of code.split('\n').filter(text => /response\.json\(\{ data|metadata:/.test(text)))
        expect(line.replace('secret_replaced: secret !== undefined', '')).not.toMatch(/\bsecret\b/)
    }
    expect(list).not.toContain('encrypted_secret')
    expect(await source('app/Support/commerceStores.ts')).not.toContain('encrypted_secret')
  })

  test('one store per provider, and the endpoint is written before the connection', async () => {
    const connect = await source('app/Actions/Api/V1/Commerce/ConnectStoreAction.ts')
    expect(connect).toContain("return response.json({ error: 'This workspace already has a store connected for that provider' }, 409)")
    expect(connect.indexOf('WebhookEndpoint.forceCreate')).toBeLessThan(connect.indexOf('CommerceConnection.forceCreate'))
    expect(connect.indexOf('WebhookEndpoint.forceCreate')).toBeGreaterThan(connect.indexOf('409'))
  })

  test('pausing a store pauses its endpoint, so webhooks are refused at the door', async () => {
    expect(STORE_STATUS_ENDPOINT).toEqual({ active: 'active', disabled: 'paused' })
    const ingest = await source('app/Actions/Webhooks/IngestWebhookAction.ts')
    expect(ingest).toContain("endpoint.status !== 'active'")
  })

  test('names and secrets are normalized by rule', () => {
    expect(normalizeStoreName('  Main   store ')).toBe('Main store')
    expect(normalizeStoreName('x')).toBeUndefined()
    expect(normalizeStoreName('x'.repeat(SERVER_NAME_MAX + 1))).toBeUndefined()
    expect(normalizeStoreName(42)).toBeUndefined()
    expect(normalizeStoreSecret(' signing-secret-1 ')).toBe('signing-secret-1')
    expect(normalizeStoreSecret('short')).toBeUndefined()
    expect(normalizeStoreSecret('has a space in it')).toBeUndefined()
    expect(storeProvider(' Shopify ')).toBe('shopify')
    for (const value of ['stripe', 'csv', '', null])
      expect(storeProvider(value)).toBeUndefined()
    expect(webhookPath('shopify', 'abc')).toBe('/api/webhooks/shopify/abc')
  })
})

describe('the page agrees with the server', () => {
  test('the same providers, limits and nothing else', () => {
    expect(STORE_PROVIDERS.map(item => item.provider)).toEqual([...SERVER_PROVIDERS])
    expect([STORE_NAME_MIN, STORE_NAME_MAX]).toEqual([SERVER_NAME_MIN, SERVER_NAME_MAX])
    expect([SECRET_MIN, SECRET_MAX]).toEqual([CREDENTIAL_MIN, CREDENTIAL_MAX])
  })

  test('still true: only these providers\' webhooks become commerce events, of these kinds', async () => {
    // The day the job handles another provider or writes another kind, this
    // fails and the page's lists and its notice are revisited.
    const job = await source('app/Jobs/ProcessWebhookEvent.ts')
    expect(job).toContain(`if ([${SERVER_PROVIDERS.map(provider => `'${provider}'`).join(', ')}].includes(String(event.provider)))`)
    const payload = await source('app/Support/webhookPayload.ts')
    expect(payload).toContain(`export function commerceEventType(type: unknown): ${EVENT_TYPES.map(item => `'${item.value}'`).join(' | ')}`)
  })

  test('still true: nothing reads a commerce event except this page', async () => {
    // The notice says events are not matched to contacts, campaigns or
    // automations. The job writes them; nothing else may read them yet.
    const root = new URL('../../', import.meta.url).pathname
    const files = await Array.fromAsync(new Bun.Glob('app/{Actions,Jobs,Support,Listeners}/**/*.ts').scan({ cwd: root, onlyFiles: true }))
    const readers = []
    for (const file of files) {
      if (/CommerceEvent\b|commerce_events/.test(await Bun.file(`${root}${file}`).text()))
        readers.push(file)
    }
    expect(readers.sort()).toEqual(['app/Actions/Api/V1/Commerce/ListStoresAction.ts', 'app/Jobs/ProcessWebhookEvent.ts'])
    expect(NOT_USED_YET).toContain('not yet matched to contacts')
    expect(await source('resources/components/CommsHQ/CommerceWorkspace.stx')).toContain('{{ notUsedYet }}')
  })
})

describe('what the page shows', () => {
  test('a store that is receiving', () => {
    const view = toStoreView({ id: 1, provider: 'shopify', name: ' Main store ', status: 'active', endpoint_status: 'active', webhook_url: 'https://commshq.org/api/webhooks/shopify/abc', events: 1240, last_event_at: '2026-11-13T12:00:00.000Z', failed_deliveries: 0 })
    expect(view).toMatchObject({ name: 'Main store', providerLabel: 'Shopify', statusLabel: 'Receiving', nextStatus: 'disabled', nextLabel: 'Pause', failedNote: '' })
    expect(view.standing).toStartWith('1,240 events recorded, the latest ')
    expect(view.setup).toContain('Shopify')
  })

  test('a quiet store, a paused one, and one with failed deliveries', () => {
    expect(toStoreView({ id: 2, provider: 'woocommerce', status: 'active', endpoint_status: 'active', webhook_url: 'https://x.test/a' }).standing).toBe('Nothing has arrived from this store yet.')
    expect(toStoreView({ id: 2, provider: 'woocommerce', status: 'disabled', endpoint_status: 'paused', webhook_url: 'https://x.test/a' })).toMatchObject({ statusLabel: 'Paused', nextStatus: 'active', nextLabel: 'Resume' })
    expect(toStoreView({ id: 2, status: 'active', endpoint_status: 'active', webhook_url: 'https://x.test/a', failed_deliveries: 1 }).failedNote).toBe('1 delivery arrived and could not be recorded.')
    expect(toStoreView({ id: 2, status: 'active', endpoint_status: 'active', webhook_url: 'https://x.test/a', events: 1, last_event_at: '2026-11-13T12:00:00.000Z' }).standing).toStartWith('1 event recorded')
  })

  test('a store that cannot receive is never shown as receiving', () => {
    // No endpoint, or a paused one behind an active connection.
    expect(toStoreView({ id: 3, provider: 'shopify', status: 'active', webhook_url: null })).toMatchObject({ statusLabel: 'Not receiving', webhookUrl: '', nextStatus: '' })
    expect(toStoreView({ id: 3, provider: 'shopify', status: 'active', endpoint_status: 'paused', webhook_url: 'https://x.test/a' }).statusLabel).toBe('Not receiving')
  })

  test('permission is only a literal true, and a connected kind is no longer offered', () => {
    expect(toStoresView({ data: [], can_manage: true }).canManage).toBe(true)
    for (const body of [{ data: [] }, { data: [], can_manage: 'true' }, { data: [], can_manage: 1 }, null, undefined])
      expect(toStoresView(body as any).canManage).toBe(false)
    expect(toStoresView(null).available.map(item => item.provider)).toEqual(['shopify', 'woocommerce'])
    expect(toStoresView({ data: [{ id: 1, provider: 'shopify' }] }).available.map(item => item.provider)).toEqual(['woocommerce'])
  })

  test('an event shows its kind, amount and reference, and never its payload', () => {
    const view = toEventView({ id: 9, external_id: 'wc-505', type: 'order_refunded', amount: 4250, currency: 'eur', occurred_at: '2026-11-13T12:00:00.000Z', commerce_connection_id: 1, payload: '{"email":"buyer@example.com"}' } as any, 'en-US')
    expect(view).toMatchObject({ typeLabel: 'Refund', amountLabel: '€42.50', reference: 'wc-505', storeId: 1 })
    expect(JSON.stringify(view)).not.toContain('buyer@example.com')
    expect(toEventView({ id: 1, type: 'cart_updated' }).typeLabel).toBe('Cart updated')
  })

  test('an amount is minor units in its own currency', () => {
    expect(formatAmount(1999, 'USD')).toBe('$19.99')
    expect(formatAmount(1999, null)).toBe('$19.99')
    expect(formatAmount(500, 'not-a-code')).toBe('5.00 NOT-A-CODE')
    for (const amount of [0, null, undefined, '', 'many', -5])
      expect(formatAmount(amount, 'USD')).toBe('')
  })
})

describe('what the page sends', () => {
  test('a draft is checked by the server\'s rules', () => {
    expect(connectError({ provider: 'stripe', name: 'Main', secret: 'signing-secret-1' })).toContain('Choose which kind')
    expect(connectError({ provider: 'shopify', name: 'M', secret: 'signing-secret-1' })).toContain('at least 2')
    expect(connectError({ provider: 'shopify', name: 'x'.repeat(121), secret: 'signing-secret-1' })).toContain('at most 120')
    expect(connectError({ provider: 'shopify', name: 'Main', secret: '' })).toBe('Enter the signing secret.')
    expect(connectError({ provider: 'shopify', name: 'Main', secret: 'short' })).toContain('too short')
    expect(connectError({ provider: 'shopify', name: 'Main', secret: 'has a space' })).toContain('spaces')
    expect(connectError({ provider: 'woocommerce', name: 'Main', secret: 'signing-secret-1' })).toBe('')
    expect(secretError('x'.repeat(4097))).toContain('at most 4096')
  })

  test('the payload is the three fields, trimmed', () => {
    expect(connectPayload({ provider: 'shopify', name: '  Main   store ', secret: ' signing-secret-1 ' })).toEqual({ provider: 'shopify', name: 'Main store', secret: 'signing-secret-1' })
  })

  test('the page clears the secret from its form whatever the outcome, and asks twice before pausing', async () => {
    const page = await source('resources/components/CommsHQ/CommerceWorkspace.stx')
    expect(page).toContain("// Whatever happened, the secret does not stay in the form.\n    addSecret.set('')")
    expect(page).toContain("if (next === 'disabled' && confirmId() !== id) {")
    expect(page.match(/type="password"/g)?.length).toBe(2)
  })

  test('failures are explained by their status', () => {
    expect(listErrorMessage(401, 'events')).toContain('see your events')
    expect(listErrorMessage(503)).toBe('Stores could not be loaded because the API is not answering.')
    expect(saveErrorMessage(409)).toContain('connected once')
    expect(saveErrorMessage(403)).toContain('admin or owner')
    expect(saveErrorMessage(418)).toContain('(418)')
  })

  test('the user-visible text has no em-dash or en-dash', async () => {
    const text = `${await source('resources/data/commerce-query.ts')}${await source('resources/components/CommsHQ/CommerceWorkspace.stx')}`
    expect(text).not.toMatch(/[—–]/)
  })
})
