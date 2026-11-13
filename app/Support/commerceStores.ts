import { config } from '@stacksjs/config'
import { db } from '@stacksjs/database'
import { canManageIntegrations, normalizeCredential } from './integrationConnectors'

/**
 * Connecting a store, which is two rows that have to agree.
 *
 * A store's orders arrive as webhooks. `IngestWebhookAction` accepts one
 * only at an active inbound `WebhookEndpoint` whose secret verifies the
 * signature, and `ProcessWebhookEvent` records it as a commerce event only
 * when the workspace has an active `CommerceConnection` for that provider.
 * Until now nothing could create either: the endpoint's secret is guarded,
 * so the generated API had no way to store one, and an endpoint with no
 * secret verifies nothing.
 *
 * So a "store" here is one connection and one endpoint for the same
 * provider, created together, paused together and resumed together.
 *
 * One store per provider per workspace. The job picks the first active
 * connection for the provider, so a second one would receive nothing or
 * everything, and the page could not say which.
 */
export const STORE_PROVIDERS = ['shopify', 'woocommerce'] as const

export type StoreProvider = typeof STORE_PROVIDERS[number]

export const STORE_NAME_MIN = 2
export const STORE_NAME_MAX = 120

/** What a store's connection may be set to from the page, and what its endpoint follows with. */
export const STORE_STATUS_ENDPOINT: Record<string, string> = {
  active: 'active',
  disabled: 'paused',
}

export function storeProvider(value: unknown): StoreProvider | undefined {
  const provider = String(value ?? '').trim().toLowerCase()
  return (STORE_PROVIDERS as readonly string[]).includes(provider) ? provider as StoreProvider : undefined
}

export function normalizeStoreName(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const name = value.replace(/\s+/g, ' ').trim()
  return name.length >= STORE_NAME_MIN && name.length <= STORE_NAME_MAX ? name : undefined
}

/** The signing secret, by the same rule as any stored credential. */
export function normalizeStoreSecret(value: unknown): string | undefined {
  return normalizeCredential(value)
}

/** Connecting a store decides what the workspace accepts from outside. */
export function canManageCommerce(role: unknown): boolean {
  return canManageIntegrations(role)
}

/** Where the store sends its webhooks. The endpoint's uuid is the address, not a secret. */
export function webhookPath(provider: string, endpointUuid: string): string {
  return `/api/webhooks/${provider}/${endpointUuid}`
}

/** The same address with the application's own origin in front. */
export function webhookUrl(provider: string, endpointUuid: string): string {
  const configured = String(config.app.url ?? '').trim().replace(/\/+$/, '')
  const origin = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`
  return `${origin}${webhookPath(provider, endpointUuid)}`
}

export interface StoreRow {
  id: number
  provider: string
  name: string
  status: string
  created_at: string | null
}

export interface EndpointRow {
  id: number
  uuid: string
  provider: string
  status: string
}

/** The workspace's inbound endpoint for a provider, if it has one. */
export async function storeEndpoint(teamId: number, provider: string): Promise<EndpointRow | undefined> {
  return await db.selectFrom('webhook_endpoints' as any)
    .select(['id', 'uuid', 'provider', 'status'] as any)
    .where('team_id' as any, '=', teamId)
    .where('provider' as any, '=', provider)
    .where('direction' as any, '=', 'inbound')
    .orderBy('id' as any, 'asc')
    .executeTakeFirst() as EndpointRow | undefined
}
