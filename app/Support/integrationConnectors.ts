import { providerFor, supportedPlatforms } from './reputationProviders'

/**
 * The services a workspace can store a credential for.
 *
 * Only the ones something reads. `integration_credentials.provider` allows
 * nine values, but the application looks a credential up in one place,
 * `credentialFor`, for the reputation providers. Offering Twilio, Stripe or
 * Shopify here would store a secret that nothing uses and show a connection
 * that connects nothing. The list is derived from the provider registry, so
 * a new provider appears here when it is registered and not before.
 */
export interface Connector {
  /** The `IntegrationCredential.provider` value. */
  provider: string
  /** The reputation platform whose profiles this credential unlocks. */
  platform: string
  /** What to store, in the provider's own words. */
  hint: string
}

export function connectors(): Connector[] {
  const seen = new Set<string>()
  const list: Connector[] = []
  for (const platform of supportedPlatforms()) {
    const provider = providerFor(platform)
    if (!provider || seen.has(provider.credentialProvider))
      continue
    seen.add(provider.credentialProvider)
    list.push({ provider: provider.credentialProvider, platform: provider.platform, hint: provider.credentialHint })
  }
  return list
}

export function connectorFor(provider: unknown): Connector | undefined {
  const key = String(provider ?? '').trim().toLowerCase()
  return connectors().find(item => item.provider === key)
}

export const CREDENTIAL_MIN = 8
export const CREDENTIAL_MAX = 4096
/** The one credential a workspace holds per service. */
export const CONNECTION_NAME = 'Default connection'

/** A secret as it is stored: trimmed, or undefined when it is not a plausible one. */
export function normalizeCredential(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const secret = value.trim()
  if (secret.length < CREDENTIAL_MIN || secret.length > CREDENTIAL_MAX || /\s/.test(secret))
    return undefined
  return secret
}

/**
 * The last four characters, for telling two keys apart on screen.
 *
 * Only for a secret of sixteen characters or more. Four characters of a
 * short secret are a real share of it, and the hint is not worth that.
 */
export function lastFourOf(secret: string): string | null {
  return secret.length >= 16 ? secret.slice(-4) : null
}

/** Storing or removing a credential changes what the workspace can reach. */
export function canManageIntegrations(role: unknown): boolean {
  return ['owner', 'admin'].includes(String(role || '').toLowerCase())
}
