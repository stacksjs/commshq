import { route } from '@stacksjs/router'

/**
 * Signing in and signing up.
 *
 * These strings resolve to this app's own overrides in
 * `app/Actions/Auth/*` (app actions win over the framework defaults of the
 * same route string). They are re-mounted at the root with `.skipCsrf()`
 * because the same-origin `fetch()` the login/register pages make carries no
 * CSRF token; the auth-token cookie is `SameSite=Lax`, which is what guards
 * these posts against cross-site abuse. User route files load before the
 * framework defaults, so these win on the duplicate method and path.
 *
 * The rate limits are kept, and they are the point: this is the only
 * unauthenticated surface in the app that touches the user table.
 *
 * Every session-issuing action (Login, Register, VerifyTwoFactorLogin) sets a
 * single HttpOnly `auth-token` cookie whose Max-Age matches the token's own
 * expiry, so a server-rendered page can identify the caller without the client
 * handing it anything. There is no refresh exchange: the cookie IS the session
 * (7-day baseline, 30 days with "keep me signed in").
 */
route.post('/login', 'Actions/Auth/LoginAction').skipCsrf().rateLimit(5, 'minute')
route.post('/register', 'Actions/Auth/RegisterAction').skipCsrf().rateLimit(3, 'minute')
route.post('/logout', 'Actions/Auth/LogoutAction').skipCsrf()

/**
 * Step two of a 2FA sign-in. `skipCsrf()` for the same reason as the others —
 * the login page posts JSON with no CSRF token — and the auth here is the
 * short-lived, single-use challenge token minted by LoginAction, not a cookie.
 */
route.post('/verify-two-factor-login', 'Actions/Auth/VerifyTwoFactorLoginAction').skipCsrf().rateLimit(10, 'minute')
