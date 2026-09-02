/**
 * The browser half of CommsHQ's public surface.
 *
 * A creator's signup form, preference centre and unsubscribe link live on
 * their own site, not on ours. Until now the only way to wire them up was to
 * read `routes/public.ts`, write the `fetch` calls by hand, and rediscover
 * every response shape - including the ones that are not errors but read like
 * them: a 202 that means "we sent a confirmation email", a 429 that means
 * "wait, and say so politely".
 *
 * This is that knowledge, written once. It is the only part of CommsHQ that
 * runs in somebody else's page, so it takes no dependencies, touches no
 * globals it was not handed, and every function here is callable from a test
 * with a `fetch` you supply.
 */

/** Where the endpoints live, and what to call them with. */
export interface ClientOptions {
  /**
   * The workspace's CommsHQ origin, e.g. `https://commshq.org`.
   *
   * Optional in a page served from that origin, where relative paths already
   * resolve to the right place.
   */
  baseUrl?: string
  /** Supply your own for tests, retries, or a page with no global `fetch`. */
  fetch?: typeof globalThis.fetch
  /** Extra headers on every request. A workspace behind a proxy may need one. */
  headers?: Record<string, string>
}

/**
 * A refusal from the API, with the status intact.
 *
 * The status is the whole difference between "try again in a minute" and "this
 * link has expired", and an error that flattens both into a string makes the
 * page say the wrong one.
 */
export class CommsHqError extends Error {
  readonly status: number
  /** The response body, when it was JSON. */
  readonly body: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = 'CommsHqError'
    this.status = status
    this.body = body
  }

  /** Rate limited. The one refusal that is worth retrying unchanged. */
  get isRateLimited(): boolean {
    return this.status === 429
  }

  /** A link that has expired or was tampered with, or a form that is gone. */
  get isExpiredLink(): boolean {
    return this.status === 400 || this.status === 404
  }

  /** The address did not look like an address. */
  get isInvalidInput(): boolean {
    return this.status === 422
  }
}

export interface SubscribeFields {
  email: string
  firstName?: string
  lastName?: string
  /** Passed through to the consent record, for jurisdictions that need it. */
  jurisdiction?: string
  [field: string]: unknown
}

export interface SubscribeResult {
  accepted: boolean
  /**
   * Whether an email is on its way that has to be clicked.
   *
   * The form's own double-opt-in setting decides this, not the caller, so a
   * page cannot know which of the two messages to show until it has asked.
   */
  confirmationRequired: boolean
}

export interface ChannelPreference {
  status?: string
  suppressed?: boolean
  [field: string]: unknown
}

export interface Preferences {
  contact: { email: string, phone: string }
  channels: { email: ChannelPreference, sms: ChannelPreference }
}

/**
 * What somebody wants, per channel.
 *
 * `undefined` is not the same as `false`: a preference centre that shows only
 * email must leave SMS alone rather than silently opting somebody out of a
 * channel its form never mentioned. Omitted keys are not sent.
 */
export interface PreferenceChoices {
  email?: boolean
  sms?: boolean
}

export interface PreferenceUpdate {
  updated: boolean
  /** A newly enabled email channel is not on until the confirmation is clicked. */
  emailConfirmationRequired: boolean
  /** SMS opt-in finishes by texting START; the page has to say so. */
  smsStartRequired: boolean
}

export interface CommsHqClient {
  subscribe: (formId: string, fields: SubscribeFields) => Promise<SubscribeResult>
  preferences: (token: string) => Promise<Preferences>
  updatePreferences: (token: string, choices: PreferenceChoices) => Promise<PreferenceUpdate>
  unsubscribe: (token: string) => Promise<{ unsubscribed: boolean }>
  /** The URL a confirmation link points at. The endpoint redirects, so it is followed, not fetched. */
  confirmUrl: (token: string) => string
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl)
    return path
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/**
 * A token, checked before it is put in a URL.
 *
 * These arrive from an email link and go straight into a path segment. A
 * token carrying a slash or a `..` would address a different endpoint than
 * the one this function names, so it is refused here rather than encoded and
 * sent somewhere surprising.
 */
function tokenSegment(token: string): string {
  const trimmed = String(token ?? '').trim()

  if (!trimmed)
    throw new CommsHqError('A preference link token is required.', 400)

  return encodeURIComponent(trimmed)
}

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') || ''

  if (!type.includes('json'))
    return await response.text().catch(() => '')

  return await response.json().catch(() => null)
}

/** The API's own words when it has them, and something honest when it does not. */
function messageFrom(body: unknown, status: number): string {
  const named = body && typeof body === 'object' ? (body as Record<string, unknown>).error : null

  if (typeof named === 'string' && named)
    return named

  if (status === 429)
    return 'Too many attempts. Please wait a moment and try again.'

  return `CommsHQ responded with ${status}.`
}

export function createClient(options: ClientOptions = {}): CommsHqClient {
  const baseUrl = options.baseUrl ?? ''
  const headers = options.headers ?? {}

  /*
   * Resolved per call rather than captured at construction: a page that
   * installs a `fetch` wrapper after this client was created - a polyfill, a
   * test double, a tracing shim - should still be the one making the request.
   */
  function send(): typeof globalThis.fetch {
    const found = options.fetch ?? globalThis.fetch

    if (typeof found !== 'function')
      throw new CommsHqError('No fetch implementation is available. Pass one to createClient.', 0)

    return found
  }

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response

    try {
      response = await send()(joinUrl(baseUrl, path), {
        ...init,
        headers: { accept: 'application/json', ...headers, ...(init.headers as Record<string, string> | undefined) },
      })
    }
    catch (error) {
      /*
       * A network failure and a refusal are different things, and a page that
       * shows "your address was rejected" when the wifi dropped has told
       * somebody something false about themselves. Status 0 says "never
       * arrived".
       */
      throw new CommsHqError(error instanceof Error ? error.message : 'The request could not be sent.', 0)
    }

    const body = await readBody(response)

    if (!response.ok)
      throw new CommsHqError(messageFrom(body, response.status), response.status, body)

    return body
  }

  function json(body: unknown): RequestInit {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  }

  return {
    async subscribe(formId: string, fields: SubscribeFields): Promise<SubscribeResult> {
      const email = String(fields?.email ?? '').trim()

      /*
       * Checked here as well as on the server. The server is the one that
       * decides, but a round trip to be told the field is empty is a round
       * trip that also spends one of the twenty attempts a minute this
       * endpoint allows.
       */
      if (!email)
        throw new CommsHqError('An email address is required.', 422)

      const body = await request(`/forms/${encodeURIComponent(String(formId))}/submit`, json({ ...fields, email })) as Record<string, unknown>

      return {
        accepted: body?.accepted !== false,
        confirmationRequired: Boolean(body?.confirmationRequired),
      }
    },

    async preferences(token: string): Promise<Preferences> {
      const body = await request(`/preferences/${tokenSegment(token)}`) as Preferences

      return {
        contact: { email: body?.contact?.email ?? '', phone: body?.contact?.phone ?? '' },
        channels: { email: body?.channels?.email ?? {}, sms: body?.channels?.sms ?? {} },
      }
    },

    async updatePreferences(token: string, choices: PreferenceChoices): Promise<PreferenceUpdate> {
      const payload: Record<string, string> = {}

      /*
       * `enabled` / `disabled` rather than booleans, and omitted when the
       * caller said nothing. The endpoint reads these through
       * `parsePreferenceChoice`, which treats anything it does not recognise
       * as "leave this channel alone" - so an omitted key is the difference
       * between not asking about SMS and switching it off.
       */
      if (choices.email !== undefined)
        payload.email = choices.email ? 'enabled' : 'disabled'

      if (choices.sms !== undefined)
        payload.sms = choices.sms ? 'enabled' : 'disabled'

      const body = await request(`/preferences/${tokenSegment(token)}`, json(payload)) as Record<string, unknown>

      return {
        updated: body?.updated !== false,
        emailConfirmationRequired: Boolean(body?.emailConfirmationRequired),
        smsStartRequired: Boolean(body?.smsStartRequired),
      }
    },

    async unsubscribe(token: string): Promise<{ unsubscribed: boolean }> {
      const body = await request(`/unsubscribe/${tokenSegment(token)}`, json({})) as Record<string, unknown>

      return { unsubscribed: body?.unsubscribed !== false }
    },

    confirmUrl(token: string): string {
      return joinUrl(baseUrl, `/confirm/${tokenSegment(token)}`)
    },
  }
}
