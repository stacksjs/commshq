import { route } from '@stacksjs/router'

/**
 * Signing in and signing up.
 *
 * The framework already ships these actions, and its own `routes/auth.ts`
 * already mounts them - but CSRF-gated, which blocks the same-origin `fetch()`
 * the pages here make. Re-registering them at the root with `.skipCsrf()` is
 * what the sibling HQ apps do for the same reason: the session is a bearer
 * token, and a bearer token is CSRF-immune because the browser does not attach
 * it the way it attaches a cookie. User route files load before the framework
 * defaults, so these win on the duplicate method and path.
 *
 * The rate limits are kept, and they are the point: this is the only
 * unauthenticated surface in the app that touches the user table.
 *
 * `LoginAction` returns the token pack as JSON AND sets it as an httpOnly
 * cookie, so a server-rendered dashboard page can identify the caller without
 * the client handing it anything. That is why nothing here has to persist a
 * token by hand.
 */
route.post('/login', 'Actions/Auth/LoginAction').skipCsrf().rateLimit(5, 'minute')
route.post('/register', 'Actions/Auth/RegisterAction').skipCsrf().rateLimit(3, 'minute')
route.post('/logout', 'Actions/Auth/LogoutAction').skipCsrf()

/**
 * Access tokens last an hour (config/auth.ts). Without a refresh route the
 * session simply ends there, and it does not end at the sign-in page: the
 * cookie outlives the access token, so the next request renders a signed-in
 * shell with nothing behind it.
 */
route.post('/auth/refresh', 'Actions/Auth/RefreshTokenAction').skipCsrf().rateLimit(10, 'minute')

/**
 * GET endpoints must sit under `/api/**`. The view process only proxies
 * non-GET requests and the `/api/**` prefix through to this API process, so a
 * bare `GET /me` would be swallowed by the view server's page routing.
 */
route.get('/api/me', 'Actions/MeAction').skipCsrf()
