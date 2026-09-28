import { describe, expect, it } from 'bun:test'
import {
  authCookieForBrowserSession,
  browserSessionRemembered,
  resolveBrowserSessionPolicy,
  shouldSecureAuthCookie,
} from '@stacksjs/auth'
import { buildAuthCookie, sessionExpiryMinutes } from '../../app/Actions/Auth/authCookie'

/**
 * Characterization tests for the browser session contract.
 *
 * These pin what a signed-in commshq user experiences TODAY, before the
 * hand-rolled auth overrides in `app/Actions/Auth/` are deleted in favour of
 * the framework's browser-session policy (stacksjs/stacks#2795). They are
 * written against both sides at once: the app's current helpers and the
 * framework functions that will replace them. Every assertion must keep
 * passing after the swap, which is the whole point - the moment the framework
 * would issue a different cookie or a different session length, one of these
 * fails instead of a user being silently signed out or silently downgraded.
 *
 * Nothing here touches the global config: every framework call is handed an
 * explicit config object, so the results do not depend on which .env the
 * suite happens to load.
 */

/** What `config/auth.ts` sets today. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MONTH_MS = 30 * 24 * 60 * 60 * 1000

const WEEK_MINUTES = 7 * 24 * 60 // 10_080
const MONTH_MINUTES = 30 * 24 * 60 // 43_200

/** The config the app must carry for the framework to reproduce today's tiers. */
const TIERED_AUTH = {
  tokenExpiry: WEEK_MS,
  browserSession: { baselineLifetime: WEEK_MS, rememberedLifetime: MONTH_MS },
}

describe('browser session: lifetime tiers', () => {
  it('is a week unchecked and a month when remembered, today', () => {
    expect(sessionExpiryMinutes(undefined)).toBe(WEEK_MINUTES)
    expect(sessionExpiryMinutes(true)).toBe(MONTH_MINUTES)
  })

  it('reproduces both tiers through the framework policy, given the config', () => {
    expect(resolveBrowserSessionPolicy(undefined, TIERED_AUTH).expiresInMinutes).toBe(WEEK_MINUTES)
    expect(resolveBrowserSessionPolicy(true, TIERED_AUTH).expiresInMinutes).toBe(MONTH_MINUTES)
  })

  /**
   * The regression this whole file exists for. `rememberedLifetime` defaults to
   * the baseline, so deleting the overrides WITHOUT adding the browserSession
   * block silently collapses "keep me signed in for 30 days" to 7 days. No
   * error, no test failure anywhere else, no user-visible signal until someone
   * is logged out 23 days early.
   */
  it('collapses the remembered tier to the baseline when browserSession is absent', () => {
    const untiered = { tokenExpiry: WEEK_MS }

    expect(resolveBrowserSessionPolicy(true, untiered).expiresInMinutes).toBe(WEEK_MINUTES)
    expect(resolveBrowserSessionPolicy(true, untiered).expiresInMinutes).not.toBe(MONTH_MINUTES)
  })
})

describe('browser session: the remember accept-list', () => {
  // Everything `resources/views/login.stx` can put in the JSON body. It sends a
  // real boolean from `checkbox.checked` at step one and re-sends the stored
  // choice at step two, but the action has always accepted the string forms too.
  const remembered = [true, 1, '1', 'true', 'on', 'yes', 'TRUE', ' true ']
  const notRemembered = [false, 0, undefined, null, '', '0', 'false', 'off', 'no']

  it('agrees with the framework on every value the login view can send', () => {
    for (const value of [true, false, undefined, '1', 'true', 'on', 'yes', '', '0'])
      expect(sessionExpiryMinutes(value) === MONTH_MINUTES).toBe(browserSessionRemembered(value))
  })

  it('treats the documented truthy forms as remembered', () => {
    for (const value of remembered)
      expect(resolveBrowserSessionPolicy(value, TIERED_AUTH).remembered).toBe(true)
  })

  it('treats everything else as the baseline', () => {
    for (const value of notRemembered)
      expect(resolveBrowserSessionPolicy(value, TIERED_AUTH).remembered).toBe(false)
  })
})

describe('browser session: the cookie contract', () => {
  it('names, scopes and flags the cookie exactly as it does today', () => {
    const cookie = buildAuthCookie('a'.repeat(80), WEEK_MINUTES * 60)

    expect(cookie).toContain(`auth-token=${'a'.repeat(80)}`)
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=604800')
  })

  /**
   * The cookie's Max-Age and the `oauth_access_tokens.expires_at` row have to
   * come from the SAME number, or the browser keeps sending a credential the
   * database has already expired (or drops one that is still valid).
   */
  it('stamps Max-Age from the issued lifetime, not from a recomputed default', () => {
    const issued = 1234
    expect(buildAuthCookie('token', issued)).toContain(`Max-Age=${issued}`)
    expect(authCookieForBrowserSession('token', issued)).toContain(`Max-Age=${issued}`)
  })

  it('refuses to invent a lifetime when issuance did not report one', () => {
    expect(() => authCookieForBrowserSession('token', undefined)).toThrow(TypeError)
    expect(() => authCookieForBrowserSession('token', 0)).toThrow(TypeError)
    expect(() => authCookieForBrowserSession('token', -1)).toThrow(TypeError)
  })

  it('leaves an 80-character hex token byte-identical through cookie encoding', () => {
    // Access tokens are randomBytes(40).toString('hex'), on which
    // encodeURIComponent is the identity - so no live session is invalidated
    // when issuance moves from the app helper to the framework one.
    const token = 'deadbeef'.repeat(10)
    expect(token).toHaveLength(80)
    expect(encodeURIComponent(token)).toBe(token)
    expect(authCookieForBrowserSession(token, 60)).toContain(`auth-token=${token}`)
  })
})

describe('browser session: two-factor keeps the tier', () => {
  /**
   * Step two must not downgrade a remembered session. Today `login.stx` stores
   * the checkbox at step one and re-sends it with the code, and
   * `VerifyTwoFactorLoginAction` runs it back through `sessionExpiryMinutes`.
   * The framework carries it on the challenge id instead. Either way the
   * property is the same, so this assertion survives the swap.
   */
  it('resolves a remembered challenge to the month, not the week', () => {
    expect(sessionExpiryMinutes(true)).toBe(MONTH_MINUTES)
    expect(resolveBrowserSessionPolicy(true, TIERED_AUTH).lifetimeMs).toBe(MONTH_MS)
  })

  it('resolves an unremembered challenge to the week', () => {
    expect(sessionExpiryMinutes(false)).toBe(WEEK_MINUTES)
    expect(resolveBrowserSessionPolicy(false, TIERED_AUTH).lifetimeMs).toBe(WEEK_MS)
  })
})

describe('browser session: refresh tokens', () => {
  /**
   * Browser sessions are fixed-lifetime: no refresh exchange. The framework
   * still defaults `withRefreshToken` to true, so turning it off is a
   * deliberate, separately reviewable change rather than a side effect of the
   * migration. Pinning the default here makes that flip visible.
   */
  it('defaults to issuing a refresh token', () => {
    expect(resolveBrowserSessionPolicy(undefined, { tokenExpiry: WEEK_MS }).withRefreshToken).toBe(true)
  })

  it('honours an explicit opt-out', () => {
    const fixed = { ...TIERED_AUTH, browserSession: { ...TIERED_AUTH.browserSession, withRefreshToken: false } }
    expect(resolveBrowserSessionPolicy(true, fixed).withRefreshToken).toBe(false)
  })
})

describe('browser session: the Secure flag', () => {
  /**
   * The one difference that is a security regression rather than a cosmetic
   * change. The app helper decides Secure from APP_ENV; the framework decides
   * it from `config.app.url`. commshq's url falls back to `commshq.localhost`
   * (config/app.ts:15), which the framework reads as a loopback host and
   * therefore serves WITHOUT Secure - a 7-to-30 day session cookie in the
   * clear if APP_URL is ever absent or fails to decrypt.
   *
   * These assertions document the trap. `config.auth.cookie.secure` must be set
   * explicitly in the migration so the inference never runs.
   */
  it('secures an https app url', () => {
    expect(shouldSecureAuthCookie({ url: 'https://commshq.com' })).toBe(true)
  })

  it('secures a non-loopback host even over plain http', () => {
    expect(shouldSecureAuthCookie({ url: 'http://commshq.com' })).toBe(true)
  })

  it('DROPS Secure for the commshq.localhost fallback - the trap', () => {
    expect(shouldSecureAuthCookie({ url: 'commshq.localhost' })).toBe(false)
    expect(shouldSecureAuthCookie({ url: 'http://localhost:3000' })).toBe(false)
  })

  it('still sets Secure today, because the app helper reads APP_ENV', () => {
    // Guards the current behavior: whatever the migration does, a production
    // cookie must keep this attribute.
    const production = buildAuthCookieUnder('production')
    expect(production).toContain('Secure')
  })
})

/** Build a cookie with APP_ENV temporarily set, then restore it. */
function buildAuthCookieUnder(appEnv: string): string {
  const previous = process.env.APP_ENV
  process.env.APP_ENV = appEnv
  try {
    return buildAuthCookie('token', 60)
  }
  finally {
    if (previous === undefined)
      delete process.env.APP_ENV
    else process.env.APP_ENV = previous
  }
}
