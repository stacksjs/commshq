import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { clearAuthCookie } from './authCookie'

/**
 * Project override of the framework's default LogoutAction — same token
 * revocation, plus clearing the HttpOnly auth cookie the session paths set
 * (see authCookie.ts for why the cookie exists at all).
 */
export default new Action({
  name: 'LogoutAction',
  description: 'Logout from the application',
  method: 'POST',
  async handle(request: RequestInstance) {
    // `Auth.logout()` resolves the token from the Authorization header or the
    // auth cookie, so this revokes the session either way.
    await Auth.logout()

    const clearCookie = clearAuthCookie()

    // A browser signing out via a plain <form method="POST"> makes a full-page
    // navigation, not an XHR, so returning JSON would render the raw payload in
    // the tab. Redirect browser navigations to /login; XHR/API callers (Accept:
    // application/json) still get JSON.
    const accept = String(request.headers?.get?.('accept') ?? '')
    if (accept.includes('text/html')) {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/login', 'Set-Cookie': clearCookie },
      })
    }

    return response.json(
      { message: 'Successfully logged out' },
      { status: 200, headers: { 'Set-Cookie': clearCookie } },
    )
  },
})
