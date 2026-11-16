/**
 * Where to go after signing in or creating an account.
 *
 * Both pages go to the dashboard. The exceptions are a person who arrived
 * from an invitation link, or from a terminal's connect link: they are sent
 * back to it, so the thing they came to do is one step after signing in.
 *
 * The return path is taken from the address bar, which anyone can write, so
 * it is never followed as given. It is honoured only when it is exactly an
 * invitation page or a connect approve page on this site; anything else, including an absolute URL or
 * a path that merely starts the same way, falls back to the dashboard. A
 * sign-in page that redirects wherever its query string says is a phishing
 * tool with the site's own name on it.
 */
export const DASHBOARD_PATH = '/dashboard/commshq'
export const INVITATION_PREFIX = '/team-invitations/'

/** An invitation token is 32 random bytes as base64url: letters, digits, `-` and `_`. */
const INVITATION_PATH = /^\/team-invitations\/[\w-]{20,200}$/

export function invitationPath(token: unknown): string {
  const value = String(token ?? '')
  return /^[\w-]{20,200}$/.test(value) ? `${INVITATION_PREFIX}${value}` : ''
}

/**
 * The page a terminal's `buddy hq:connect` is approved on, with its code.
 *
 * The second exception, for the same reason as the first. Somebody who opens
 * an approve link signed out used to be sent to sign in, landed on the
 * dashboard, and took that for the connect having worked: the page that asks
 * for the confirmation code was a tab they never went back to. A connect code
 * is 32 random bytes as base64url.
 */
const CONNECT_PATH = /^\/cli\/connect\?code=[\w-]{16,128}$/

export function connectPath(code: unknown): string {
  const value = String(code ?? '')
  return /^[\w-]{16,128}$/.test(value) ? `/cli/connect?code=${value}` : ''
}

export function afterSignIn(next: unknown): string {
  const path = Array.isArray(next) ? String(next[0] ?? '') : String(next ?? '')
  return INVITATION_PATH.test(path) || CONNECT_PATH.test(path) ? path : DASHBOARD_PATH
}

/** A sign-in or register link that comes back to this approve page afterwards. */
export function withConnectReturn(page: '/login' | '/register', code: unknown): string {
  const path = connectPath(code)
  return path ? `${page}?next=${encodeURIComponent(path)}` : page
}

/** A sign-in or register link that comes back to this invitation afterwards. */
export function withReturn(page: '/login' | '/register', token: unknown): string {
  const path = invitationPath(token)
  return path ? `${page}?next=${encodeURIComponent(path)}` : page
}
