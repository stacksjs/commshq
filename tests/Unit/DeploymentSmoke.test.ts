import { describe, expect, it } from 'bun:test'
import { assertSessionCookie, assertSessionCookieAttributes } from '../../scripts/smoke-deployment'

/**
 * The deploy smoke test signs in for real and spends the session on an
 * authenticated route. These cover the header parsing without a network round
 * trip, so a broken assertion is caught here rather than by a red deploy.
 */

const LIVE = 'auth-token=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure'

describe('deployment smoke: session cookie parsing', () => {
  it('reads the token out of a live Set-Cookie header', () => {
    expect(assertSessionCookie(LIVE)).toBe('abc123')
  })

  it('url-decodes the value, since the framework encodes it', () => {
    expect(assertSessionCookie('auth-token=a%2Bb; Path=/; HttpOnly')).toBe('a+b')
  })

  it('finds the cookie when other cookies precede it', () => {
    expect(assertSessionCookie('other=1; Path=/, auth-token=xyz; Path=/; HttpOnly')).toBe('xyz')
  })

  it('names the real failure when sign-in issued no cookie at all', () => {
    expect(() => assertSessionCookie(null)).toThrow('issued no session')
    expect(() => assertSessionCookie(undefined)).toThrow('issued no session')
  })

  it('distinguishes a missing cookie from an empty one', () => {
    expect(() => assertSessionCookie('session=nope; Path=/')).toThrow('set no auth-token cookie')
    expect(() => assertSessionCookie('auth-token=; Path=/')).toThrow('empty auth-token cookie')
  })
})

describe('deployment smoke: session cookie attributes', () => {
  it('accepts the attributes a deployed session must carry', () => {
    expect(() => assertSessionCookieAttributes(LIVE)).not.toThrow()
  })

  /**
   * The regression this guards. shouldSecureAuthCookie() reads config.app.url,
   * which falls back to commshq.localhost - a loopback host, so the flag is
   * dropped and a 7-to-30 day session token ships in the clear.
   */
  it('rejects a production cookie served without Secure', () => {
    expect(() => assertSessionCookieAttributes('auth-token=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'))
      .toThrow('missing Secure')
  })

  it('rejects a cookie readable by JavaScript', () => {
    expect(() => assertSessionCookieAttributes('auth-token=abc; Path=/; SameSite=Lax; Max-Age=604800; Secure'))
      .toThrow('missing HttpOnly')
  })

  it('reports every missing attribute at once', () => {
    expect(() => assertSessionCookieAttributes('auth-token=abc; Max-Age=604800'))
      .toThrow('missing HttpOnly, Path=/, SameSite=Lax, Secure')
  })

  it('rejects a session cookie with no positive Max-Age', () => {
    const base = 'auth-token=abc; Path=/; HttpOnly; SameSite=Lax; Secure'
    expect(() => assertSessionCookieAttributes(base)).toThrow('no positive Max-Age')
    expect(() => assertSessionCookieAttributes(`${base}; Max-Age=0`)).toThrow('no positive Max-Age')
  })
})
