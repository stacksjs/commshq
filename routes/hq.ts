/**
 * commshq: the HQ connect and usage endpoints (`@stacksjs/hq/service`), and
 * the things a connected app may do with its send key.
 *
 *   POST /api/cli/connect                 -> { code, approveUrl, confirmCode }
 *   GET  /api/cli/connect/{code}          -> pending | approved + send key and read key (once) | expired
 *   POST /api/cli/connect/{code}/approve  -> the approve page's action (signed-in admin or owner)
 *   GET  /api/v1/usage         (read key) -> [{ meter, used, limit, period, state, upgradeUrl }]
 *
 *   POST /api/v1/send                  (send key) -> one transactional email
 *   POST /api/v1/app/contacts          (send key) -> add or update a contact
 *   POST /api/v1/app/signup-form       (send key) -> the app's own signup form, made on first asking
 *   POST /api/v1/sending-domain        (send key) -> register the app's domain, answer its DNS records
 *   POST /api/v1/sending-domain/verify (send key) -> look the records up and say what was found
 *
 * `buddy hq:connect commshq` drives the connect and the sending domain. The
 * framework's `commshq` mail driver calls `/api/v1/send`. None of the keyed
 * routes reads a session: the key is the caller, and it is one app's.
 */

import type { HqRequest } from '@stacksjs/hq/service'
import type { ConnectedApp } from '../app/Hq/apps'
import { config } from '@stacksjs/config'
import { route } from '@stacksjs/router'
import { authenticateSendKey, ConnectRefusedError, registerSendingDomain, sendForApp, signupFormForApp, upsertContactForApp, verifySendingDomain } from '../app/Hq/apps'
import { bearerKey } from '../app/Hq/keys'
import { rateLimit } from '../app/Hq/limits'
import { MAX_PER_RECIPIENT_PER_HOUR } from '../app/Hq/standing'
import { appOrigin, canSignOutbound, fallbackAddress, hq, lookupTxt, notifyPaused, sqlAppStore, transport } from '../app/Hq/service'
import { activeTeam } from '../app/Support/activeTeam'

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    // Codes and keys travel in these bodies: nothing may keep one.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

/** What the handlers below read off the router's request. */
interface RouterRequest {
  url: string
  method?: string
  headers: Headers
  params?: Record<string, string | undefined>
  jsonBody?: Record<string, unknown> | null
  /** The router's own slot for the signed-in user, where the auth middleware filled it. */
  user?: unknown
  _authenticatedUser?: unknown
}

/**
 * The router has already read the body into `jsonBody`, so the stream the
 * package would call `json()` on is spent. Hand it what was parsed.
 */
function hqRequest(request: RouterRequest): HqRequest {
  return {
    url: String(request.url),
    method: request.method,
    headers: request.headers,
    params: request.params,
    json: async () => request.jsonBody ?? {},
  }
}

/** The signed-in user behind a request the auth middleware let through, or null. */
async function userId(request: RouterRequest): Promise<number | null> {
  // The auth middleware leaves the user on the request, as the object on one
  // router version and behind a function on another.
  const slot = request._authenticatedUser ?? request.user
  const user = (typeof slot === 'function' ? await (slot as () => Promise<unknown>)().catch(() => null) : slot) as { id?: unknown } | null | undefined
  const id = Number(user?.id)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Is this request's `Origin` this site's? A cookie-authenticated POST whose
 * effect is worth forging refuses any other. A request with no `Origin` is
 * let through: that is what a server-to-server call looks like, and the
 * endpoint behind this still needs a session.
 */
function sameOrigin(request: RouterRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin)
    return true
  try {
    const mine = new URL(/^https?:\/\//.test(String(config.app?.url)) ? String(config.app?.url) : `https://${config.app?.url}`).host.replace(/^www\./, '')
    return new URL(origin).host.replace(/^www\./, '') === mine
  }
  catch {
    return false
  }
}

// --- Connect ---

// Anyone can ask for a code, and each one is a row until it expires ten
// minutes later. Ten a minute per address is far more than a CLI needs.
route.post('/api/cli/connect', (request: RouterRequest) => hq.startConnect(hqRequest(request)))
  .skipCsrf().rateLimit(10, 'minute') // called by a CLI: no browser, no cookie, nothing to forge

// A CLI polls about once every two seconds while the person approves.
route.get('/api/cli/connect/{code}', (request: RouterRequest) =>
  hq.pollConnect(hqRequest(request), String(request.params?.code ?? ''))).rateLimit(120, 'minute')

route.get('/api/v1/usage', (request: RouterRequest) => hq.usage(hqRequest(request))).rateLimit(120, 'minute')

// The approve page's button. Cookie-authenticated, so it checks the Origin:
// approving hands keys that send mail as the workspace to whoever holds the
// code. The confirmation code is the framework's to check; wrong guesses are
// limited per person here, since six characters at ten tries a minute cannot
// be guessed within the ten minutes a connect lives.
const APPROVE_LIMIT = 10
const APPROVE_WINDOW_MS = 60_000

route.post('/api/cli/connect/{code}/approve', async (request: RouterRequest) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const id = await userId(request)
  if (id === null)
    return json({ error: 'unauthorized' }, 401)

  const limit = rateLimit(`hq-approve:${id}`, APPROVE_LIMIT, APPROVE_WINDOW_MS)
  if (!limit.ok)
    return json({ error: 'Too many attempts. Wait a minute and try again.' }, 429, { 'Retry-After': String(limit.retryAfter) })

  try {
    // The workspace open in the dashboard, chosen with the switcher.
    const team = await activeTeam(request as any)
    const result = await hq.approveConnect(String(request.params?.code ?? ''), { id, team }, request.jsonBody?.confirm)
    if (!result.ok) {
      if (result.reason === 'confirmation_mismatch')
        return json({ error: 'That code does not match. Enter the confirmation code your terminal is showing.', reason: result.reason }, 422)
      return json({
        error: result.reason === 'already_approved'
          ? 'This connection was already approved.'
          : 'This connection request has expired. Run the command again.',
        reason: result.reason,
      }, result.reason === 'already_approved' ? 409 : 410)
    }
    return json({ ok: true, project: result.project })
  }
  catch (error) {
    if (error instanceof ConnectRefusedError)
      return json({ error: error.message, reason: error.reason }, 403)
    console.error('[hq] could not approve connect:', error instanceof Error ? error.message : error)
    return json({ error: 'Could not approve the connection. Please try again.' }, 500)
  }
}).middleware('auth').skipCsrf()

// --- What a send key may do ---

/** One key's sends a minute. An app that needs more is a campaign, and has its own road. */
const SEND_LIMIT = 120
const KEY_WINDOW_MS = 60_000

/** The app behind the request's send key, or the response that refuses it. */
async function appFor(request: RouterRequest, scope: string, limit: number): Promise<ConnectedApp | Response> {
  const app = await authenticateSendKey(sqlAppStore, bearerKey(request.headers.get('authorization')))
  if (!app)
    return json({ error: 'unauthorized' }, 401)
  const window = rateLimit(`hq-${scope}:${app.id}`, limit, KEY_WINDOW_MS)
  if (!window.ok)
    return json({ error: 'Too many requests for this app. Try again shortly.' }, 429, { 'Retry-After': String(window.retryAfter) })
  return app
}

// One address, one app, one hour: a signup or reset that loops must not
// become a flood in somebody's inbox.
function recipientAllowed(appId: string, address: string, now: Date): boolean {
  return rateLimit(`send:${appId}:${address}`, MAX_PER_RECIPIENT_PER_HOUR, 3_600_000, now.getTime()).ok
}

route.post('/api/v1/send', async (request: RouterRequest) => {
  const app = await appFor(request, 'send', SEND_LIMIT)
  if (app instanceof Response)
    return app
  const result = await sendForApp(app, request.jsonBody, { store: sqlAppStore, transport, fallbackAddress, canSign: canSignOutbound, recipientAllowed, notifyPaused })
  return result.ok ? json(result.data, result.status) : json({ error: result.error }, result.status)
}).skipCsrf().rateLimit(600, 'minute')

// Not `/api/v1/contacts`: that is the dashboard's own, behind a session.
route.post('/api/v1/app/contacts', async (request: RouterRequest) => {
  const app = await appFor(request, 'contacts', 300)
  if (app instanceof Response)
    return app
  const result = await upsertContactForApp(app, request.jsonBody, { store: sqlAppStore })
  return result.ok ? json(result.data, result.status) : json({ error: result.error }, result.status)
}).skipCsrf().rateLimit(600, 'minute')

const domainDeps = {
  store: sqlAppStore,
  lookupTxt,
  fallbackFrom: (app: ConnectedApp) => `${app.name} via CommsHQ <${fallbackAddress()}>`,
}

route.post('/api/v1/sending-domain', async (request: RouterRequest) => {
  const app = await appFor(request, 'domain', 30)
  if (app instanceof Response)
    return app
  const result = await registerSendingDomain(app, request.jsonBody?.domain, domainDeps)
  return result.ok ? json({ data: result.data }) : json({ error: result.error }, result.status)
}).skipCsrf().rateLimit(60, 'minute')

// The form an app's own page posts email addresses to. Asked for by key, so
// the app never has to be given a form id by hand: the first call makes the
// form and its audience, and every later call answers the same one.
route.post('/api/v1/app/signup-form', async (request: RouterRequest) => {
  const app = await appFor(request, 'form', 30)
  if (app instanceof Response)
    return app
  const result = await signupFormForApp(app, request.jsonBody, { store: sqlAppStore, origin: appOrigin })
  return result.ok ? json({ data: result.data }) : json({ error: result.error }, result.status)
}).skipCsrf().rateLimit(60, 'minute')

route.post('/api/v1/sending-domain/verify', async (request: RouterRequest) => {
  const app = await appFor(request, 'domain', 30)
  if (app instanceof Response)
    return app
  const result = await verifySendingDomain(app, request.jsonBody?.domain, domainDeps)
  return result.ok ? json({ data: result.data }) : json({ error: result.error }, result.status)
}).skipCsrf().rateLimit(60, 'minute')
