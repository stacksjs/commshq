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

/**
 * Password reset, all three steps.
 *
 * The framework registers these same paths from its defaults, but without
 * `skipCsrf()`, and the view server never seeds the token cookie - only the API
 * router does, on its own GET responses. So a page rendered by `buddy serve`
 * has no token to echo and every one of them answered 403 before this block
 * existed. Measured, not assumed: a plain POST to /password/forgot returned
 * `{"error":"Forbidden","message":"CSRF token mismatch"}`.
 *
 * Registering them here wins, because app routes load ahead of the defaults,
 * and it buys the rate limits the default registration does not carry. Those
 * limits are the real protection on this surface: CSRF defends a session, and
 * the point of these three is that the caller has no session. What they can be
 * abused for is mailing a stranger on demand, and a limit is what stops that.
 *
 * The windows match analyticshq, which has run this shape in production
 * longest: sending is the expensive one, verifying is cheap and gets retried
 * when somebody re-opens the emailed link.
 */
route.post('/password/forgot', 'Actions/Password/SendPasswordResetEmailAction').skipCsrf().rateLimit(3, 'minute')
route.post('/password/reset', 'Actions/Password/PasswordResetAction').skipCsrf().rateLimit(5, 'minute')
route.post('/password/verify-token', 'Actions/Password/VerifyResetTokenAction').skipCsrf().rateLimit(10, 'minute')
