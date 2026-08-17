import type { MentionKind, ReputationPlatform } from '../platforms'

/** A mention normalized out of a provider payload, before sentiment is applied. */
export interface NormalizedMention {
  /** Stable provider-side identifier; the dedupe key together with the profile. */
  externalId: string
  kind: MentionKind
  authorName: string | null
  authorHandle: string | null
  body: string
  rating: number | null
  url: string | null
  language: string | null
  postedAt: string
  raw: Record<string, unknown>
}

export interface FetchMentionsInput {
  /** The provider-side identifier of the listing or handle being polled. */
  externalId: string
  handle: string | null
  /** Opaque provider cursor persisted between polls; null on a first sync. */
  cursor: string | null
  /** Only mentions posted at or after this instant are wanted. */
  since: string | null
  limit: number
  /** Decrypted credential material for the workspace. */
  secret: string
}

export interface FetchMentionsResult {
  mentions: NormalizedMention[]
  /** Cursor to persist for the next poll, or null when the provider has no paging state. */
  cursor: string | null
}

export interface ReputationProvider {
  platform: ReputationPlatform
  /** The `IntegrationCredential.provider` value this client reads its secret from. */
  credentialProvider: string
  /** Operator-facing description of what the credential must contain. */
  credentialHint: string
  fetchMentions: (input: FetchMentionsInput) => Promise<FetchMentionsResult>
}

/** Raised when a workspace has not connected the credential a provider needs. */
export class ProviderNotConfiguredError extends Error {
  readonly code = 'provider_not_configured'
  constructor(readonly platform: string, hint: string) {
    super(`No credential connected for ${platform}. ${hint}`)
    this.name = 'ProviderNotConfiguredError'
  }
}

/** Raised for a provider HTTP or payload failure, carrying whether a retry is worthwhile. */
export class ProviderRequestError extends Error {
  readonly code = 'provider_request_failed'
  constructor(readonly platform: string, readonly status: number, message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'ProviderRequestError'
  }
}

/** 429 and 5xx are worth another attempt; a 4xx means the request or credential is wrong. */
export function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export async function readJson(response: Response, platform: string): Promise<any> {
  const text = await response.text()
  if (!response.ok) {
    throw new ProviderRequestError(
      platform,
      response.status,
      `${platform} responded ${response.status}: ${text.slice(0, 300)}`,
      retryableStatus(response.status),
    )
  }
  try {
    return JSON.parse(text)
  }
  catch {
    throw new ProviderRequestError(platform, response.status, `${platform} returned a non-JSON body`, false)
  }
}
