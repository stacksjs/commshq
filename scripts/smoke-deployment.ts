import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface SmokeContract {
  domain: string
  homeText: string
}

const CONTRACTS: Record<string, SmokeContract> = {
  analyticshq: { domain: 'analyticshq.org', homeText: 'analyticshq' },
  bughq: { domain: 'bughq.org', homeText: 'Error tracking for people who ship.' },
  commshq: { domain: 'commshq.org', homeText: 'Grow an audience worth knowing.' },
  loghq: { domain: 'loghq.org', homeText: 'Your logs, finally worth reading.' },
  reportshq: { domain: 'reportshq.org', homeText: 'Reports that build themselves' },
  status: { domain: 'statushq.org', homeText: 'Know the moment' },
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

if (import.meta.main) {
  const home = await readWithRetry('/')
  if (!home.includes(contract.homeText)) throw new Error(`Homepage does not contain the expected release marker: ${contract.homeText}`)

  const login = await readWithRetry('/login')
  if (!/<(?:form|main)\b/i.test(login)) throw new Error('Login smoke response does not contain an application form or main region.')

  const robots = await readWithRetry('/robots.txt')
  if (robots.includes('http://localhost')) throw new Error('Deployed robots.txt contains a localhost URL.')
  if (!robots.includes(new URL(baseUrl).hostname)) throw new Error(`Deployed robots.txt does not name ${new URL(baseUrl).hostname}.`)

  const signedIn = await assertSignInWorks()

  console.log(`Deployment smoke passed for ${baseUrl}: homepage, login, ${signedIn ? 'a real sign-in, ' : ''}and robots metadata are live.`)
}
