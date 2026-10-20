import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface SmokeContract {
  domain: string
  homeText: string
  /** Whether POST /api/email/subscribe is registered in that app. */
  subscribe: boolean
}

const CONTRACTS: Record<string, SmokeContract> = {
  analyticshq: { domain: 'analyticshq.org', homeText: 'analyticshq', subscribe: true },
  bughq: { domain: 'bughq.org', homeText: 'Error tracking for people who ship.', subscribe: false },
  commshq: { domain: 'commshq.org', homeText: 'Grow an audience worth knowing.', subscribe: true },
  loghq: { domain: 'loghq.org', homeText: 'Your logs, finally worth reading.', subscribe: true },
  reportshq: { domain: 'reportshq.org', homeText: 'Reports that build themselves', subscribe: true },
  status: { domain: 'statushq.org', homeText: 'Know the moment', subscribe: true },
}

const projectRoot = resolve(import.meta.dir, '..')
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { name?: string }
const packageName = String(packageJson.name || '')
const directoryName = projectRoot.split('/').pop() || ''
const appName = CONTRACTS[packageName] ? packageName : directoryName
const contract = CONTRACTS[appName]

if (!contract) throw new Error(`No deployment smoke contract exists for ${appName || '(unnamed)'}.`)

const baseUrl = String(process.env.SMOKE_BASE_URL || `https://${contract.domain}`).replace(/\/$/, '')
const attempts = Math.max(1, Number(process.env.SMOKE_ATTEMPTS || 10))
const pauseMs = Math.max(0, Number(process.env.SMOKE_RETRY_MS || 3000))

async function readWithRetry(path: string): Promise<string> {
  let lastFailure = 'no response'
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const separator = path.includes('?') ? '&' : '?'
      const response = await fetch(`${baseUrl}${path}${separator}smoke=${Date.now()}`, {
        headers: { accept: path === '/robots.txt' ? 'text/plain' : 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      })
      const body = await response.text()
      if (response.ok) return body
      lastFailure = `HTTP ${response.status}`
    }
    catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
    }
    if (attempt < attempts) await Bun.sleep(pauseMs)
  }
  throw new Error(`${baseUrl}${path} failed after ${attempts} attempts: ${lastFailure}`)
}

/**
 * The token out of a `Set-Cookie` header, or a failure that says which half of
 * the contract broke.
 *
 * Exported so the parsing can be tested without a network round trip; the live
 * checks below only run under `import.meta.main`.
 */
export function assertSessionCookie(setCookie: string | null | undefined): string {
  if (!setCookie)
    throw new Error('POST /login returned no Set-Cookie header, so the sign-in issued no session.')

  const match = /(?:^|,\s*)auth-token=([^;,\s]*)/.exec(setCookie)
  if (!match)
    throw new Error(`POST /login set no auth-token cookie. Set-Cookie was: ${setCookie.slice(0, 200)}`)
  if (!match[1])
    throw new Error('POST /login set an empty auth-token cookie.')

  return decodeURIComponent(match[1])
}

/**
 * The attributes a deployed session cookie must carry.
 *
 * `Secure` is checked because the framework decides it from `config.app.url`,
 * which falls back to `commshq.localhost` — a loopback host, which drops the
 * flag. A misconfigured or undecryptable APP_URL would therefore ship a
 * long-lived session token in the clear, and nothing else would notice.
 */
export function assertSessionCookieAttributes(setCookie: string): void {
  const required = ['HttpOnly', 'Path=/', 'SameSite=Lax', 'Secure']
  const missing = required.filter(attribute => !new RegExp(`(?:^|;\\s*)${attribute}`, 'i').test(setCookie))

  if (missing.length)
    throw new Error(`The deployed auth-token cookie is missing ${missing.join(', ')}. Set-Cookie was: ${setCookie.slice(0, 200)}`)

  if (!/(?:^|;\s*)Max-Age=[1-9]\d*/i.test(setCookie))
    throw new Error(`The deployed auth-token cookie carries no positive Max-Age. Set-Cookie was: ${setCookie.slice(0, 200)}`)
}

/**
 * Sign in for real, then spend the session on an authenticated route.
 *
 * Static page checks pass with sign-in completely broken, which is how a
 * schema or session regression reaches production unnoticed. `/api/v1/workspace`
 * is the only auth-guarded GET in routes/api.ts, so it is the one route that can
 * be exercised without a side effect.
 *
 * Deliberately not retried: POST /login is rate limited to 5/minute
 * (routes/auth.ts:23), and a retry loop would spend that budget and report a
 * 429 as a deploy failure.
 */
async function assertSignInWorks(): Promise<boolean> {
  const email = process.env.SMOKE_EMAIL
  const password = process.env.SMOKE_PASSWORD

  if (!email || !password) {
    console.log('  sign-in leg skipped: SMOKE_EMAIL and SMOKE_PASSWORD are not set.')
    return false
  }

  const signIn = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  })

  if (signIn.status !== 200)
    throw new Error(`POST /login returned ${signIn.status}, expected 200. A 422 usually means the smoke credentials are wrong; a 429 means the rate limit was already spent.`)

  const setCookie = signIn.headers.get('set-cookie')
  if (!setCookie && /twoFactor|two_factor|challenge/i.test(await signIn.clone().text()))
    throw new Error('POST /login answered with a two-factor challenge instead of a session. The smoke account must not have two-factor enabled.')

  const token = assertSessionCookie(setCookie)
  assertSessionCookieAttributes(setCookie as string)

  const workspace = await fetch(`${baseUrl}/api/v1/workspace`, {
    headers: { accept: 'application/json', cookie: `auth-token=${encodeURIComponent(token)}` },
    signal: AbortSignal.timeout(15_000),
  })

  if (workspace.status !== 200)
    throw new Error(`GET /api/v1/workspace returned ${workspace.status} for a freshly issued session. A 401 means the cookie was not accepted; a 403 means the smoke account belongs to no team.`)

  return true
}

/*
 * Unresolved stx expressions in the SERVED html.
 *
 * This has to run against a served page, because the two render paths disagree:
 * `bun run build` resolves a component's expressions correctly, while
 * `buddy serve` — what production actually runs — can ship the component's own
 * template verbatim. bughq went live with every <Button> reading
 * `class="{{ buttonClasses }}"` while its dist/ was correct and lint, tsc, stx
 * typecheck, the tests and release:validate were all clean (stacksjs/stx#2037).
 * No check over dist/ can see it.
 *
 * Attributes specifically: the visual gate already looks for `{{`, but through
 * `document.body.innerText`, which by definition never contains an attribute
 * value. That blind spot is why it shipped. A served attribute value never
 * legitimately contains `{{`.
 */
function unresolvedAttributes(html: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(/\s([a-zA-Z_:@][\w:.-]*)\s*=\s*"([^"]*\{\{[^"]*)"/g))
    found.add(`${m[1]}="${m[2].trim()}"`)
  return [...found]
}

if (import.meta.main) {
  const home = await readWithRetry('/')
  if (!home.includes(contract.homeText)) throw new Error(`Homepage does not contain the expected release marker: ${contract.homeText}`)

  const login = await readWithRetry('/login')
  if (!/<(?:form|main)\b/i.test(login)) throw new Error('Login smoke response does not contain an application form or main region.')

  for (const [label, body] of [['homepage', home], ['login', login]] as const) {
    const leftovers = unresolvedAttributes(body)
    if (leftovers.length > 0) {
      throw new Error(
        `Deployed ${label} ships ${leftovers.length} unresolved stx expression(s) in attributes, `
        + `so a component rendered its own template instead of its output: ${leftovers.join(', ')}`,
      )
    }
  }

  /*
   * The newsletter endpoint, which is really a database read wearing a form.
   *
   * Added because two sites served a 500 here for an unknown length of time and
   * every gate stayed green: loghq had never created the `subscribers` table at
   * all, and reportshq deploys had never run a migration. The checks above cannot
   * see it. They read the homepage, the login page and robots.txt, and all three
   * were perfect on both sites throughout.
   *
   * THE PAYLOAD IS THE WHOLE POINT, and an invalid one would be useless here.
   * The framework action validates before it queries:
   *
   *     if (!email || !email.includes('@')) return { success: false, ... }
   *
   * so an empty body returns 200 WITHOUT TOUCHING THE DATABASE. Measured against
   * the two broken sites while they were broken: `{}` gave 200 and a real address
   * gave 500. A smoke check built on the polite empty payload would have passed
   * on both.
   *
   * So it sends a real address, and a FIXED one. The action looks the address up
   * before it writes and returns "Already subscribed" when it finds it, so the
   * first run after a database is created writes one row and every run after that
   * is a pure read of the table this is here to prove exists. A fresh address per
   * run would add a row per deploy forever.
   *
   * `.invalid` is reserved by RFC 2606 and resolves nowhere, so the row can never
   * become mail to a real person even if someone later points a campaign at the
   * subscriber list.
   */
  const SMOKE_SUBSCRIBER = 'smoke-probe@example.invalid'

  async function assertSubscribeWorks(): Promise<void> {
    let lastFailure = 'no response'
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/api/email/subscribe`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify({ email: SMOKE_SUBSCRIBER, source: 'deploy-smoke' }),
          signal: AbortSignal.timeout(10_000),
        })
        const body = await response.text()

        // A 5xx is the failure this exists to catch, and it is worth naming
        // separately: it means the route resolved and the handler threw, which is
        // the missing-table shape rather than a missing route.
        if (response.status >= 500) {
          throw new Error(
            `${baseUrl}/api/email/subscribe answered ${response.status}. The route is registered and `
            + `the handler threw, which is what a missing \`subscribers\` table looks like from outside. `
            + `Check that migrations ran on this box. Body: ${body.slice(0, 200)}`,
          )
        }

        if (!response.ok) {
          lastFailure = `HTTP ${response.status}`
        }
        else {
          const parsed = JSON.parse(body) as { success?: boolean, message?: string }
          if (parsed.success !== true)
            throw new Error(`Subscribe endpoint returned success=${parsed.success}: ${body.slice(0, 200)}`)
          return
        }
      }
      catch (error) {
        // A thrown assertion is a real failure and must not be retried into a
        // timeout; only transport problems are worth another attempt.
        if (error instanceof Error && error.message.startsWith(baseUrl)) throw error
        if (error instanceof Error && error.message.startsWith('Subscribe endpoint')) throw error
        lastFailure = error instanceof Error ? error.message : String(error)
      }
      if (attempt < attempts) await Bun.sleep(pauseMs)
    }
    throw new Error(`${baseUrl}/api/email/subscribe failed after ${attempts} attempts: ${lastFailure}`)
  }

  if (contract.subscribe) await assertSubscribeWorks()

  const robots = await readWithRetry('/robots.txt')
  if (robots.includes('http://localhost')) throw new Error('Deployed robots.txt contains a localhost URL.')
  if (!robots.includes(new URL(baseUrl).hostname)) throw new Error(`Deployed robots.txt does not name ${new URL(baseUrl).hostname}.`)

  const signedIn = await assertSignInWorks()

  console.log(`Deployment smoke passed for ${baseUrl}: homepage, login, ${signedIn ? 'a real sign-in, ' : ''}robots metadata, and no unresolved stx expressions are live.`)
}
