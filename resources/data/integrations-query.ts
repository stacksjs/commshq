/**
 * Service credentials, through the application's own API.
 *
 * This page was the `integrations` area of `WorkspaceSurface`: seven
 * connected services, a 99.98% webhook success rate, latencies for mail,
 * Twilio and Bedrock. Nothing recorded any of it. Underneath, a workspace
 * could not store a credential at all, so a monitored reputation profile
 * could be added and would stay unconfigured for good.
 *
 * It lists the services a credential can be stored for, shows which are
 * connected, and stores, replaces or removes a credential. The value is
 * sent once, encrypted by the server and never returned; the page only ever
 * sees the last four characters.
 *
 * ## What the page does not show
 *
 * Only the services something reads a credential for, which today are the
 * two reputation providers. Mail, SMS, payments and AI are configured in the
 * deployment's environment, not per workspace, so there is nothing to
 * connect for them here. No webhook success rate and no latencies: nothing
 * aggregates them. No webhook endpoints either, whose secrets have no way
 * in yet.
 */
import { formatSeen } from './contacts-query'

export const CREDENTIALS_ENDPOINT = '/api/v1/integration-credentials'
export const CREDENTIALS_PER_PAGE = 100
export const CREDENTIAL_MIN = 8
export const CREDENTIAL_MAX = 4096

/**
 * The services a credential can be stored for, with what to store.
 *
 * The same list `app/Support/integrationConnectors.ts` derives from the
 * provider registry, written out here because a client module cannot import
 * the server's. A test holds the two together, hint for hint.
 */
export const CONNECTORS = [
  {
    provider: 'google_business',
    label: 'Google Business',
    purpose: 'Reads the reviews on your Google Business listings for the Reputation page.',
    hint: 'Store an OAuth access token with the business.manage scope, and set the profile identifier to accounts/{account}/locations/{location}.',
  },
  {
    provider: 'yelp',
    label: 'Yelp',
    purpose: 'Reads the reviews on your Yelp listings for the Reputation page.',
    hint: 'Store a Yelp Fusion API key as the credential value.',
  },
] as const

export function credentialsUrl(): string {
  const params = new URLSearchParams()
  params.set('per_page', String(CREDENTIALS_PER_PAGE))
  params.set('sort', 'provider,id')
  return `${CREDENTIALS_ENDPOINT}?${params.toString()}`
}

export function credentialUrl(id: number): string {
  return `${CREDENTIALS_ENDPOINT}/${Math.trunc(Number(id))}`
}

export interface CredentialRow {
  id: number
  provider?: string | null
  last_four?: string | null
  rotated_at?: string | null
  created_at?: string | null
}

export interface ConnectorView {
  provider: string
  label: string
  purpose: string
  hint: string
  connected: boolean
  /** The stored credential's id, 0 when there is none. */
  credentialId: number
  standing: string
}

/**
 * One row per connectable service, joined to the credential stored for it.
 *
 * Every connector is shown whether or not it is connected, since the list
 * of what can be connected is the point of the page. A stored credential
 * for a service that is not a connector is left out: nothing reads it, and
 * the page would have nothing true to say about it.
 */
export function toConnectorViews(body: { data?: CredentialRow[] } | null | undefined, locale?: string): ConnectorView[] {
  const rows = body?.data ?? []
  return CONNECTORS.map((connector) => {
    const row = rows.find(item => item.provider === connector.provider)
    let standing = 'Not connected.'
    if (row) {
      const ending = (row.last_four || '').trim()
      const when = row.rotated_at ? `replaced ${formatSeen(row.rotated_at, locale)}` : `stored ${formatSeen(row.created_at, locale)}`
      standing = ending ? `Connected. Credential ending in ${ending}, ${when}.` : `Connected. Credential ${when}.`
    }
    return {
      provider: connector.provider,
      label: connector.label,
      purpose: connector.purpose,
      hint: connector.hint,
      connected: Boolean(row),
      credentialId: row ? Number(row.id) : 0,
      standing,
    }
  })
}

export function connectorLabel(provider?: string | null): string {
  return CONNECTORS.find(item => item.provider === provider)?.label ?? 'This service'
}

/** Why a credential cannot be stored, by the rule the server applies. */
export function credentialDraftError(draft: { provider?: string, value?: string }): string {
  if (!CONNECTORS.some(item => item.provider === draft.provider))
    return 'Choose the service this credential is for.'
  const value = (draft.value ?? '').trim()
  if (!value)
    return 'Paste the credential to store.'
  if (/\s/.test(value))
    return 'A credential cannot contain spaces or line breaks. Paste the key or token on its own.'
  if (value.length < CREDENTIAL_MIN)
    return `That is too short to be a credential. It needs at least ${CREDENTIAL_MIN} characters.`
  if (value.length > CREDENTIAL_MAX)
    return `A credential can be at most ${CREDENTIAL_MAX} characters.`
  return ''
}

export function credentialPayload(draft: { provider?: string, value?: string }): { provider: string, value: string } {
  return { provider: String(draft.provider ?? ''), value: (draft.value ?? '').trim() }
}

/** What to tell someone when the list failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your connections.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no connections to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Connections could not be loaded because the API is not answering.'
  return `Connections could not be loaded (${status}).`
}

/** What to tell someone when storing or removing was refused. */
export function credentialErrorMessage(status: number): string {
  if (status === 422)
    return 'That credential was rejected. Check that it is the whole key or token, with no spaces.'
  if (status === 404)
    return 'That connection no longer exists. The list has been refreshed.'
  if (status === 403)
    return 'Only a workspace owner or admin can change connections.'
  if (status === 401)
    return 'Your session has ended. Sign in again to continue.'
  if (status === 429)
    return 'Too many attempts just now. Wait a minute and try again.'
  return `That change could not be made (${status}).`
}
