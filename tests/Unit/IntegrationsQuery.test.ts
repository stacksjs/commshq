/**
 * Service credentials: what can be connected, and what never leaves.
 *
 * Two rules hold the rest up. A stored secret is never returned, by the
 * model, by the store action or by anything logged about it. And only the
 * services something reads a credential for can be connected, so the page
 * never shows a connection that connects nothing.
 */
import { describe, expect, test } from 'bun:test'
import {
  canManageIntegrations,
  CONNECTION_NAME,
  connectorFor,
  connectors,
  CREDENTIAL_MAX as SERVER_MAX,
  CREDENTIAL_MIN as SERVER_MIN,
  lastFourOf,
  normalizeCredential,
} from '../../app/Support/integrationConnectors'
import {
  CONNECTORS,
  connectorLabel,
  CREDENTIAL_MAX,
  CREDENTIAL_MIN,
  credentialDraftError,
  credentialErrorMessage,
  credentialPayload,
  CREDENTIALS_ENDPOINT,
  credentialsUrl,
  credentialUrl,
  listErrorMessage,
  toConnectorViews,
} from '../../resources/data/integrations-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

describe('what can be connected', () => {
  test('the server list is the reputation providers, one per credential', () => {
    expect(connectors().map(item => item.provider).sort()).toEqual(['google_business', 'yelp'])
    expect(connectorFor(' Yelp ')?.platform).toBe('yelp')
    expect(connectorFor('stripe')).toBeUndefined()
    expect(connectorFor(null)).toBeUndefined()
  })

  test('the page offers exactly those, with the provider\'s own instructions', () => {
    const server = connectors()
    expect(CONNECTORS.map(item => item.provider).sort()).toEqual(server.map(item => item.provider).sort())
    for (const connector of CONNECTORS)
      expect(connector.hint).toBe(server.find(item => item.provider === connector.provider)?.hint ?? '')
  })

  test('only owners and admins change connections', () => {
    expect(['owner', 'ADMIN', 'member', 'viewer', null].map(role => canManageIntegrations(role))).toEqual([true, true, false, false, false])
  })
})

describe('a credential on the way in', () => {
  test('it is trimmed, and refused when short, long or spaced', () => {
    expect(normalizeCredential('  abcdefgh  ')).toBe('abcdefgh')
    for (const value of ['', 'short', 'has a space in it', 'line\nbreak-here', 'x'.repeat(SERVER_MAX + 1), null, 12345678, undefined])
      expect(normalizeCredential(value)).toBeUndefined()
  })

  test('the form refuses what the endpoint would', () => {
    expect(CREDENTIAL_MIN).toBe(SERVER_MIN)
    expect(CREDENTIAL_MAX).toBe(SERVER_MAX)
    expect(credentialDraftError({ provider: 'yelp', value: 'abcdefgh' })).toBe('')
    expect(credentialDraftError({ provider: 'stripe', value: 'abcdefgh' })).toContain('Choose the service')
    expect(credentialDraftError({ provider: 'yelp', value: ' ' })).toContain('Paste the credential')
    expect(credentialDraftError({ provider: 'yelp', value: 'two words' })).toContain('cannot contain spaces')
    expect(credentialDraftError({ provider: 'yelp', value: 'short' })).toContain('at least 8')
    expect(credentialDraftError({ provider: 'yelp', value: 'x'.repeat(CREDENTIAL_MAX + 1) })).toContain('at most')
    expect(credentialPayload({ provider: 'yelp', value: ' abcdefgh ' })).toEqual({ provider: 'yelp', value: 'abcdefgh' })
  })

  test('only a long secret gives up its last four characters', () => {
    expect(lastFourOf('abcdefghijklmnop')).toBe('mnop')
    expect(lastFourOf('abcdefghijklmno')).toBeNull()
  })
})

describe('a stored secret never comes back', () => {
  test('the model hides and encrypts the value and publishes reads only', async () => {
    const model = await source('app/Models/IntegrationCredential.ts')
    expect(model).toMatch(/encryptedValue: \{[^}]*hidden: true[^}]*encrypted: true/)
    expect(model).toContain("routes: ['index', 'show'], middleware: ['auth', 'team']")
  })

  test('the store action writes through the encrypting create and answers without it', async () => {
    const store = await source('app/Actions/Api/V1/Integrations/StoreIntegrationCredentialAction.ts')
    expect(store).toContain('IntegrationCredential.forceCreate(')
    expect(store).toContain('encryptedValue: secret')
    // Nothing in the answer or the audit trail is the secret or the row.
    const answer = store.slice(store.lastIndexOf('return response.json('))
    expect(answer).not.toContain('secret,')
    expect(answer).not.toMatch(/data: created\b|created\./)
    expect(answer).not.toContain('encrypted')
    expect(store).toContain('metadata: JSON.stringify({ provider: connector.provider })')
    expect(store).not.toMatch(/log\.[a-z]+\(/)
  })

  test('storing and removing are the app actions, behind the admin gate', async () => {
    const routes = await source('routes/api.ts')
    expect(routes).toContain("route.post('/v1/integration-credentials', 'Actions/Api/V1/Integrations/StoreIntegrationCredentialAction')")
    expect(routes).toContain("route.delete('/v1/integration-credentials/{id}', 'Actions/Api/V1/Integrations/DeleteIntegrationCredentialAction')")
    for (const file of ['StoreIntegrationCredentialAction', 'DeleteIntegrationCredentialAction'])
      expect(await source(`app/Actions/Api/V1/Integrations/${file}.ts`)).toContain('canManageIntegrations(membership?.role)')
  })

  test('one credential per service, under the name the lookup expects', async () => {
    expect(CONNECTION_NAME).toBe('Default connection')
    const store = await source('app/Actions/Api/V1/Integrations/StoreIntegrationCredentialAction.ts')
    expect(store).toContain(".where('id' as any, '!=', id)")
  })
})

describe('the page', () => {
  test('it reads the generated list and removes by id', () => {
    expect(CREDENTIALS_ENDPOINT).toBe('/api/v1/integration-credentials')
    expect(Object.fromEntries(new URL(credentialsUrl(), 'https://commshq.org').searchParams.entries())).toEqual({ per_page: '100', sort: 'provider,id' })
    expect(credentialUrl(3)).toBe('/api/v1/integration-credentials/3')
  })

  test('every connector is listed, connected or not', () => {
    const views = toConnectorViews({ data: [{ id: 7, provider: 'yelp', last_four: 'mnop', created_at: '2026-11-10T09:00:00Z' }] }, 'en-US')
    expect(views.map(view => view.provider)).toEqual(['google_business', 'yelp'])
    expect(views[0]).toMatchObject({ connected: false, credentialId: 0, standing: 'Not connected.' })
    expect(views[1]).toMatchObject({ connected: true, credentialId: 7, standing: 'Connected. Credential ending in mnop, stored Nov 10, 2026.' })
  })

  test('a replaced credential says when, and a short one shows no ending', () => {
    const views = toConnectorViews({ data: [{ id: 8, provider: 'google_business', last_four: null, created_at: '2026-11-01T09:00:00Z', rotated_at: '2026-11-11T09:00:00Z' }] }, 'en-US')
    expect(views[0].standing).toBe('Connected. Credential replaced Nov 11, 2026.')
  })

  test('a credential nothing reads is not shown as a connection', () => {
    const views = toConnectorViews({ data: [{ id: 9, provider: 'stripe', last_four: '4242' }] })
    expect(views.every(view => !view.connected)).toBe(true)
    expect(toConnectorViews(null)).toHaveLength(CONNECTORS.length)
  })

  test('labels and failures read as words', () => {
    expect(connectorLabel('yelp')).toBe('Yelp')
    expect(connectorLabel('odd')).toBe('This service')
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(503)).toContain('not answering')
    expect(credentialErrorMessage(403)).toContain('owner or admin')
    expect(credentialErrorMessage(422)).toContain('rejected')
    expect(credentialErrorMessage(500)).toContain('(500)')
  })
})
