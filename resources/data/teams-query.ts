/**
 * A workspace's people, through the application's own API.
 *
 * This page was the `teams` area of `WorkspaceSurface`: seven active
 * members, two pending invites, fourteen protected actions and a list of
 * named colleagues with "last seen" times. None of it was read from
 * anywhere, and a workspace had no way to add a second person.
 *
 * The invitation flow itself is the framework's: create, mail, resend,
 * revoke and accept, and role and status changes on a member. The routes in
 * `routes/api.ts` under `/v1/teams/{id}` put this workspace's own checks in
 * front of it; `app/Support/teamAccess.ts` records which.
 *
 * ## What the page does not show
 *
 * No "last seen", no active sessions and no audit trail: the list returns
 * none of them. No ownership transfer, which the framework refuses and has
 * no action for. And no way to switch between workspaces: someone who
 * belongs to more than one lands in the one they joined first.
 */
import { formatSeen } from './contacts-query'

export const PEOPLE_ENDPOINT = '/api/v1/team/people'
export const TEAMS_PREFIX = '/api/v1/teams'

/** The roles an invitation or a role change can set. Owner is not one. */
export const ASSIGNABLE_ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
  { value: 'viewer', label: 'Viewer' },
] as const

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' }

export function roleLabel(role?: string | null): string {
  return ROLE_LABELS[String(role || '').toLowerCase()] ?? 'Member'
}

function id(value: number): number {
  return Math.trunc(Number(value))
}

export function invitationsUrl(teamId: number): string {
  return `${TEAMS_PREFIX}/${id(teamId)}/invitations`
}

export function invitationUrl(teamId: number, invitationId: number): string {
  return `${invitationsUrl(teamId)}/${id(invitationId)}`
}

export function resendUrl(teamId: number, invitationId: number): string {
  return `${invitationUrl(teamId, invitationId)}/resend`
}

export function memberUrl(teamId: number, memberId: number): string {
  return `${TEAMS_PREFIX}/${id(teamId)}/members/${id(memberId)}`
}

/** The framework's two public invitation endpoints, for the accept page. */
export function invitationUrls(token: string): { show: string, accept: string } {
  const key = encodeURIComponent(String(token ?? ''))
  return { show: `/api/team-invitation-links/${key}`, accept: `/api/team-invitations/${key}/accept` }
}

export interface Me {
  userId: number
  role: string
  canManage: boolean
  isOwner: boolean
}

export function toMe(body: { me?: Partial<Me> | null } | null | undefined): Me {
  return {
    userId: Number(body?.me?.userId) || 0,
    role: String(body?.me?.role || 'viewer'),
    canManage: body?.me?.canManage === true,
    isOwner: body?.me?.isOwner === true,
  }
}

export interface MemberRow {
  id: number
  userId?: number | null
  name?: string | null
  email?: string | null
  role?: string | null
  status?: string | null
  joinedAt?: string | null
}

export interface MemberView {
  id: number
  name: string
  email: string
  role: string
  roleLabel: string
  suspended: boolean
  standing: string
  isMe: boolean
  /** Whether this viewer may suspend, restore or remove this member. */
  canChange: boolean
  /** The role a single press would move this member to, '' when none is offered. */
  swapRole: string
  swapLabel: string
}

/**
 * Whether `me` may change this member, by the rules the server enforces in
 * `memberChangeRefusal`: a manager, never on the owner, never on yourself,
 * and only the owner on an admin. This decides which buttons show; the
 * server decides whether they work.
 */
export function canChangeMember(me: Me, member: { userId?: number | null, role?: string | null }): boolean {
  if (!me.canManage)
    return false
  const role = String(member.role || '').toLowerCase()
  if (role === 'owner' || Number(member.userId) === me.userId)
    return false
  return role !== 'admin' || me.isOwner
}

/** Normalize one member row into the shape the list renders. */
export function toMemberView(row: MemberRow, me: Me, locale?: string): MemberView {
  const role = String(row.role || 'member').toLowerCase()
  const suspended = row.status === 'suspended'
  const isMe = Number(row.userId) === me.userId
  const canChange = canChangeMember(me, row)

  // Only the owner makes or unmakes an admin, so only the owner is offered
  // the swap, and never on a suspended member.
  let swapRole = ''
  if (canChange && me.isOwner && !suspended)
    swapRole = role === 'admin' ? 'member' : 'admin'

  return {
    id: row.id,
    name: (row.name || '').trim() || (row.email || '').trim() || `Member ${row.id}`,
    email: (row.email || '').trim(),
    role,
    roleLabel: roleLabel(role),
    suspended,
    standing: `${suspended ? 'Suspended' : 'Active'}. Joined ${formatSeen(row.joinedAt ? String(row.joinedAt).replace(' ', 'T') : null, locale)}.`,
    isMe,
    canChange,
    swapRole,
    swapLabel: swapRole === 'admin' ? 'Make admin' : (swapRole === 'member' ? 'Make member' : ''),
  }
}

export function toMemberViews(body: { members?: MemberRow[], me?: Partial<Me> | null } | null | undefined, locale?: string): MemberView[] {
  const me = toMe(body)
  return (body?.members ?? []).map(row => toMemberView(row, me, locale))
}

export interface InvitationRow {
  id: number
  email?: string | null
  role?: string | null
  status?: string | null
  deliveryStatus?: string | null
  expiresAt?: string | null
}

export interface InvitationView {
  id: number
  email: string
  roleLabel: string
  standing: string
}

/** Normalize one pending invitation. Timestamps arrive as "YYYY-MM-DD HH:MM:SS" in UTC. */
export function toInvitationView(row: InvitationRow, locale?: string): InvitationView {
  const expires = row.expiresAt ? `${String(row.expiresAt).replace(' ', 'T')}Z` : null
  let standing = `Email sent. Expires ${formatSeen(expires, locale)}.`
  if (row.status === 'expired')
    standing = 'Expired. Send it again to renew it.'
  else if (row.deliveryStatus === 'failed')
    standing = 'The email could not be delivered. Send it again.'
  else if (row.deliveryStatus !== 'sent')
    standing = `Email not sent yet. Expires ${formatSeen(expires, locale)}.`

  return {
    id: row.id,
    email: (row.email || '').trim(),
    roleLabel: roleLabel(row.role),
    standing,
  }
}

export function toInvitationViews(body: { invitations?: InvitationRow[] } | null | undefined, locale?: string): InvitationView[] {
  return (body?.invitations ?? []).map(row => toInvitationView(row, locale))
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Why an invitation cannot be sent. */
export function inviteDraftError(draft: { email?: string, role?: string }, me: Me): string {
  const email = (draft.email ?? '').trim()
  if (!EMAIL.test(email) || email.length > 255)
    return 'Enter the email address of the person to invite.'
  if (!ASSIGNABLE_ROLES.some(item => item.value === draft.role))
    return 'Choose a role for this person.'
  if (draft.role === 'admin' && !me.isOwner)
    return 'Only the workspace owner can invite an admin.'
  return ''
}

export function invitePayload(draft: { email?: string, role?: string }): { email: string, role: string } {
  return { email: (draft.email ?? '').trim().toLowerCase(), role: String(draft.role || 'member') }
}

/**
 * What the server said, when it said something a person can act on.
 *
 * The framework's actions answer `{ message }` and the workspace checks in
 * front of them answer `{ error }`; both are written for the person reading
 * them, so either is shown. A missing or empty one falls back to the caller's
 * own wording.
 */
export function serverMessage(body: unknown, fallback: string): string {
  const record = (body && typeof body === 'object' ? body : {}) as { message?: unknown, error?: unknown }
  const text = String(record.message ?? record.error ?? '').trim()
  return text && text.length <= 240 ? text : fallback
}

/** What to tell someone when the list failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your workspace.'
  if (status === 403)
    return 'This account is not an active member of a workspace.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'The workspace could not be loaded because the API is not answering.'
  return `The workspace could not be loaded (${status}).`
}

/** The fallback wording when a change was refused without a usable message. */
export function changeErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to continue.'
  if (status === 403)
    return 'Your role in this workspace does not allow that change.'
  if (status === 404)
    return 'That no longer exists. The list has been refreshed.'
  if (status === 429)
    return 'Too many attempts just now. Wait a minute and try again.'
  return `That change could not be made (${status}).`
}

/** What to tell someone on the accept page when accepting was refused. */
export function acceptErrorMessage(status: number): string {
  if (status === 403)
    return 'You are signed in with a different email address. Sign in with the address this invitation was sent to.'
  if (status === 409)
    return 'This invitation has expired or was already used. Ask for a new one.'
  if (status === 404)
    return 'This invitation link is not valid. Ask for a new invitation.'
  if (status === 429)
    return 'Too many attempts just now. Wait a minute and try again.'
  return `The invitation could not be accepted (${status}).`
}
