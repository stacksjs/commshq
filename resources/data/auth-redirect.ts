/**
 * Where to go after signing in or creating an account.
 *
 * Both pages go to the dashboard. The one exception is a person who arrived
 * from an invitation link: they are sent back to it, so accepting is one
 * step after signing in and not a hunt for the email again.
 *
 * The return path is taken from the address bar, which anyone can write, so
 * it is never followed as given. It is honoured only when it is exactly an
 * invitation page on this site; anything else, including an absolute URL or
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

export function afterSignIn(next: unknown): string {
  const path = Array.isArray(next) ? String(next[0] ?? '') : String(next ?? '')
  return INVITATION_PATH.test(path) ? path : DASHBOARD_PATH
}

/** A sign-in or register link that comes back to this invitation afterwards. */
export function withReturn(page: '/login' | '/register', token: unknown): string {
  const path = invitationPath(token)
  return path ? `${page}?next=${encodeURIComponent(path)}` : page
}
