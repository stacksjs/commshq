import type { ReputationPlatform } from '../platforms'
import type { ReputationProvider } from './types'
import IntegrationCredential from '../../../Models/IntegrationCredential'
import { googleBusinessProvider } from './google-business'
import { ProviderNotConfiguredError } from './types'
import { yelpProvider } from './yelp'

/**
 * Platforms with a working client. A platform absent from this map is reported
 * as unsupported rather than silently returning an empty result, so a profile
 * never looks healthy while nothing is actually being polled.
 */
const PROVIDERS: Partial<Record<ReputationPlatform, () => ReputationProvider>> = {
  yelp: yelpProvider,
  google_business: googleBusinessProvider,
}

export function providerFor(platform: ReputationPlatform): ReputationProvider | null {
  const factory = PROVIDERS[platform]
  return factory ? factory() : null
}

export function supportedPlatforms(): ReputationPlatform[] {
  return Object.keys(PROVIDERS) as ReputationPlatform[]
}

export function isSupported(platform: ReputationPlatform): boolean {
  return Boolean(PROVIDERS[platform])
}

/**
 * Resolve the decrypted secret a provider needs for a workspace.
 *
 * `encryptedValue` is declared `encrypted: true`, so the ORM hands back
 * plaintext on read; nothing here decrypts by hand.
 */
export async function credentialFor(teamId: number, provider: ReputationProvider): Promise<string> {
  const credential = await IntegrationCredential
    .where('team_id', teamId)
    .where('provider', provider.credentialProvider)
    .first()

  const secret = String(credential?.encryptedValue || '').trim()
  if (!secret)
    throw new ProviderNotConfiguredError(provider.platform, provider.credentialHint)

  return secret
}

export * from './types'
