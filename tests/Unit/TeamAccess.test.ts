/**
 * A workspace's people: who may change them, and where sign-in may send you.
 *
 * The framework's team actions take any team id and are meant for a platform
 * administrator. The rules here are what stands between them and a workspace
 * member: the path must name the caller's own team, the caller's role must
 * allow the change, admins are the owner's to manage, and nobody edits their
 * own membership. The page mirrors those rules to decide which buttons to
 * show, and a test holds the two together.
 */
import { describe, expect, test } from 'bun:test'
import { canManageTeam, inviteRefusal, isOwner, memberChangeRefusal } from '../../app/Support/teamAccess'
import { afterSignIn, DASHBOARD_PATH, invitationPath, withReturn } from '../../resources/data/auth-redirect'
import {
  acceptErrorMessage,
  ASSIGNABLE_ROLES,
  canChangeMember,
  changeErrorMessage,
  invitationsUrl,
  invitationUrl,
  invitationUrls,
  inviteDraftError,
  invitePayload,
  listErrorMessage,
  memberUrl,
  PEOPLE_ENDPOINT,
  resendUrl,
  roleLabel,
  serverMessage,
  toInvitationView,
  toInvitationViews,
  toMe,
  toMemberView,
  toMemberViews,
} from '../../resources/data/teams-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

const TOKEN = 'q3J8mZ0bX1yT5vK2nR7wL4cD9fG6hS0aP-_uE1iO2s'
const owner = toMe({ me: { userId: 1, role: 'owner', canManage: true, isOwner: true } })
const admin = toMe({ me: { userId: 2, role: 'admin', canManage: true, isOwner: false } })
const member = toMe({ me: { userId: 3, role: 'member', canManage: false, isOwner: false } })

describe('who may change the workspace', () => {
  test('owners and admins manage, and only an owner is the owner', () => {
    expect(['owner', 'Admin', 'member', 'viewer', null].map(role => canManageTeam(role))).toEqual([true, true, false, false, false])
    expect(['owner', 'admin'].map(role => isOwner(role))).toEqual([true, false])
  })

  test('an admin invites members and viewers, and only the owner invites an admin', () => {
    expect(inviteRefusal('admin', 'member')).toBeUndefined()
    expect(inviteRefusal('admin', undefined)).toBeUndefined()
    expect(inviteRefusal('admin', ' Admin ')).toContain('Only the workspace owner')
    expect(inviteRefusal('owner', 'admin')).toBeUndefined()
    expect(inviteRefusal('member', 'viewer')).toContain('admin or owner role')
  })

  test('nobody changes their own membership', () => {
    expect(memberChangeRefusal({ actorRole: 'owner', actorUserId: 1, targetUserId: 1, targetRole: 'owner' })).toContain('your own membership')
    expect(memberChangeRefusal({ actorRole: 'admin', actorUserId: 2, targetUserId: 2, targetRole: 'admin' })).toContain('your own membership')
  })

  test('admins are the owner\'s to make, change and remove', () => {
    expect(memberChangeRefusal({ actorRole: 'admin', actorUserId: 2, targetUserId: 5, targetRole: 'admin' })).toContain('Only the workspace owner')
    expect(memberChangeRefusal({ actorRole: 'admin', actorUserId: 2, targetUserId: 5, targetRole: 'member', nextRole: 'admin' })).toContain('Only the workspace owner')
    expect(memberChangeRefusal({ actorRole: 'admin', actorUserId: 2, targetUserId: 5, targetRole: 'member', nextRole: 'viewer' })).toBeUndefined()
    expect(memberChangeRefusal({ actorRole: 'owner', actorUserId: 1, targetUserId: 5, targetRole: 'admin', nextRole: 'member' })).toBeUndefined()
    expect(memberChangeRefusal({ actorRole: 'member', actorUserId: 3, targetUserId: 5, targetRole: 'viewer' })).toContain('admin or owner role')
  })

  test('every write route passes through the caller check before the framework action', async () => {
    const routes = await source('routes/api.ts')
    for (const [file, framework] of [
      ['InviteTeamMemberAction', 'TeamInviteAction'],
      ['ResendTeamInvitationAction', 'TeamInvitationResendAction'],
      ['RevokeTeamInvitationAction', 'TeamInvitationDestroyAction'],
      ['UpdateTeamMemberAction', 'TeamMemberUpdateAction'],
      ['RemoveTeamMemberAction', 'TeamMemberDestroyAction'],
    ]) {
      expect(routes).toContain(`'Actions/Api/V1/Team/${file}').middleware('auth').middleware('team')`)
      const action = await source(`app/Actions/Api/V1/Team/${file}.ts`)
      const gate = action.indexOf('await teamCaller(request)')
      const handoff = action.indexOf(`runFrameworkTeamAction('${framework}', request)`)
      expect(gate).toBeGreaterThan(-1)
      expect(handoff).toBeGreaterThan(gate)
      // A role check of some kind sits between the two.
      expect(action.slice(gate, handoff)).toMatch(/canManageTeam\(|inviteRefusal\(|memberChangeRefusal\(/)
    }
  })

  test('a path naming another team is answered as not found', async () => {
    const access = await source('app/Support/teamAccess.ts')
    expect(access).toContain("if (Number(request.getParam('id')) !== membership.teamId)")
    expect(access).toContain("{ error: 'Team not found' }, 404")
  })

  test('pending invitations are listed only for someone who manages them', async () => {
    const list = await source('app/Actions/Api/V1/Team/ListTeamPeopleAction.ts')
    expect(list).toMatch(/manages\s*\? db\.selectFrom\('team_invitations'/)
  })
})

describe('the page shows the buttons the server would honour', () => {
  const targets = [
    { userId: 1, role: 'owner' },
    { userId: 2, role: 'admin' },
    { userId: 5, role: 'admin' },
    { userId: 6, role: 'member' },
    { userId: 3, role: 'member' },
    { userId: 7, role: 'viewer' },
  ]

  test('for every viewer and every target, the two agree', () => {
    for (const me of [owner, admin, member]) {
      for (const target of targets) {
        // The owner row is refused by the framework action itself, so the
        // server-side rule here does not need to; the page hides it anyway.
        const serverAllows = target.role !== 'owner'
          && memberChangeRefusal({ actorRole: me.role, actorUserId: me.userId, targetUserId: target.userId, targetRole: target.role }) === undefined
        expect(canChangeMember(me, target)).toBe(serverAllows)
      }
    }
  })

  test('only the owner is offered the admin swap, and not on a suspended member', () => {
    expect(toMemberView({ id: 9, userId: 6, role: 'member', status: 'active' }, owner)).toMatchObject({ canChange: true, swapRole: 'admin', swapLabel: 'Make admin' })
    expect(toMemberView({ id: 9, userId: 5, role: 'admin', status: 'active' }, owner)).toMatchObject({ swapRole: 'member', swapLabel: 'Make member' })
    expect(toMemberView({ id: 9, userId: 6, role: 'member', status: 'suspended' }, owner)).toMatchObject({ canChange: true, suspended: true, swapRole: '' })
    expect(toMemberView({ id: 9, userId: 6, role: 'member', status: 'active' }, admin)).toMatchObject({ canChange: true, swapRole: '' })
    expect(toMemberView({ id: 9, userId: 5, role: 'admin' }, admin).canChange).toBe(false)
  })

  test('a row says who it is and where it stands', () => {
    const views = toMemberViews({ me: { userId: 1, role: 'owner', canManage: true, isOwner: true }, members: [
      { id: 1, userId: 1, name: 'Maya Alvarez', email: 'maya@example.com', role: 'owner', status: 'active', joinedAt: '2026-10-20T13:41:52.649Z' },
      { id: 2, userId: 8, name: '', email: 'sam@example.com', role: 'viewer', status: 'suspended', joinedAt: '2026-11-01 09:00:00' },
    ] }, 'en-US')
    expect(views[0]).toMatchObject({ name: 'Maya Alvarez', roleLabel: 'Owner', isMe: true, canChange: false, standing: 'Active. Joined Oct 20, 2026.' })
    expect(views[1]).toMatchObject({ name: 'sam@example.com', roleLabel: 'Viewer', isMe: false, suspended: true, standing: 'Suspended. Joined Nov 1, 2026.' })
    expect(toMemberViews(null)).toEqual([])
    expect(toMe(null)).toEqual({ userId: 0, role: 'viewer', canManage: false, isOwner: false })
  })
})

describe('invitations', () => {
  test('the routes are the workspace ones, keyed by the caller\'s team', () => {
    expect(PEOPLE_ENDPOINT).toBe('/api/v1/team/people')
    expect(invitationsUrl(74)).toBe('/api/v1/teams/74/invitations')
    expect(invitationUrl(74, 3)).toBe('/api/v1/teams/74/invitations/3')
    expect(resendUrl(74, 3)).toBe('/api/v1/teams/74/invitations/3/resend')
    expect(memberUrl(74, 9)).toBe('/api/v1/teams/74/members/9')
  })

  test('a pending invitation says whether its email went out', () => {
    expect(toInvitationView({ id: 1, email: 'new@example.com', role: 'member', status: 'pending', deliveryStatus: 'sent', expiresAt: '2026-11-19 16:44:24' }, 'en-US')).toEqual({ id: 1, email: 'new@example.com', roleLabel: 'Member', standing: 'Email sent. Expires Nov 19, 2026.' })
    expect(toInvitationView({ id: 2, deliveryStatus: 'failed' }).standing).toBe('The email could not be delivered. Send it again.')
    expect(toInvitationView({ id: 3, status: 'expired', deliveryStatus: 'sent' }).standing).toBe('Expired. Send it again to renew it.')
    expect(toInvitationView({ id: 4, deliveryStatus: 'pending', expiresAt: '2026-11-19 16:44:24' }, 'en-US').standing).toBe('Email not sent yet. Expires Nov 19, 2026.')
    expect(toInvitationViews(null)).toEqual([])
  })

  test('the form asks for an address and a role the viewer may grant', () => {
    expect(ASSIGNABLE_ROLES.map(item => item.value)).toEqual(['member', 'admin', 'viewer'])
    expect(inviteDraftError({ email: 'new@example.com', role: 'member' }, admin)).toBe('')
    expect(inviteDraftError({ email: 'nope', role: 'member' }, owner)).toContain('email address')
    expect(inviteDraftError({ email: 'new@example.com', role: 'owner' }, owner)).toContain('Choose a role')
    expect(inviteDraftError({ email: 'new@example.com', role: 'admin' }, admin)).toContain('Only the workspace owner')
    expect(inviteDraftError({ email: 'new@example.com', role: 'admin' }, owner)).toBe('')
    expect(invitePayload({ email: ' New@Example.com ', role: 'viewer' })).toEqual({ email: 'new@example.com', role: 'viewer' })
  })

  test('the roles offered are the ones the table allows on an invitation', async () => {
    const records = await source('storage/framework/defaults/app/Actions/Dashboard/Teams/team-records.ts')
    expect(records).toContain("export const TEAM_INVITATION_ROLES = ['admin', 'member', 'viewer'] as const")
  })

  test('the accept page uses the framework\'s two public endpoints', async () => {
    expect(invitationUrls(TOKEN)).toEqual({ show: `/api/team-invitation-links/${TOKEN}`, accept: `/api/team-invitations/${TOKEN}/accept` })
    const routes = await source('storage/framework/defaults/routes/dashboard.ts')
    expect(routes).toContain("route.get('/api/team-invitation-links/{token}'")
    expect(routes).toContain("route.post('/api/team-invitations/{token}/accept'")
    // The link in the email is the address the accept page is served at.
    const records = await source('storage/framework/defaults/app/Actions/Dashboard/Teams/team-records.ts')
    expect(records).toContain('/team-invitations/${encodeURIComponent(token)}')
    expect(await Bun.file(new URL('../../resources/views/team-invitations/[token].stx', import.meta.url)).exists()).toBe(true)
  })
})

describe('where sign-in may send you', () => {
  test('back to an invitation page on this site, and nowhere else', () => {
    expect(afterSignIn(`/team-invitations/${TOKEN}`)).toBe(`/team-invitations/${TOKEN}`)
    for (const next of [
      undefined, null, '', '/dashboard/commshq/teams', 'https://evil.example/team-invitations/x',
      `//evil.example/team-invitations/${TOKEN}`, `/team-invitations/${TOKEN}/../../login`, `/team-invitations/${TOKEN}?x=1`,
      '/team-invitations/short', `/team-invitations/${TOKEN}#frag`, ` /team-invitations/${TOKEN}`, `javascript:alert(1)`,
    ])
      expect(afterSignIn(next)).toBe(DASHBOARD_PATH)
    // A repeated query parameter arrives as a list; only its first value counts.
    expect(afterSignIn([`/team-invitations/${TOKEN}`, 'https://evil.example'])).toBe(`/team-invitations/${TOKEN}`)
    expect(afterSignIn(['https://evil.example'])).toBe(DASHBOARD_PATH)
  })

  test('the links from the accept page carry the way back', () => {
    expect(invitationPath(TOKEN)).toBe(`/team-invitations/${TOKEN}`)
    expect(invitationPath('bad token')).toBe('')
    expect(withReturn('/login', TOKEN)).toBe(`/login?next=${encodeURIComponent(`/team-invitations/${TOKEN}`)}`)
    expect(withReturn('/register', 'x')).toBe('/register')
  })

  test('both sign-in pages go through it', async () => {
    for (const page of ['login', 'register']) {
      const view = await source(`resources/views/${page}.stx`)
      expect(view).toContain('navigate(afterSignIn(route.query.next))')
      expect(view).not.toContain("navigate('/dashboard/commshq')")
    }
  })
})

describe('what it says back', () => {
  test('a server message is shown when there is one worth showing', () => {
    expect(serverMessage({ message: 'This person is already a member of the team.' }, 'x')).toBe('This person is already a member of the team.')
    expect(serverMessage({ error: 'Only the workspace owner can invite an admin' }, 'x')).toBe('Only the workspace owner can invite an admin')
    expect(serverMessage({}, 'fallback')).toBe('fallback')
    expect(serverMessage(null, 'fallback')).toBe('fallback')
    expect(serverMessage({ message: 'm'.repeat(300) }, 'fallback')).toBe('fallback')
  })

  test('each failure names what happened', () => {
    expect(roleLabel('ADMIN')).toBe('Admin')
    expect(roleLabel('odd')).toBe('Member')
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(503)).toContain('not answering')
    expect(changeErrorMessage(403)).toContain('does not allow')
    expect(changeErrorMessage(500)).toContain('(500)')
    expect(acceptErrorMessage(403)).toContain('different email address')
    expect(acceptErrorMessage(409)).toContain('expired or was already used')
    expect(acceptErrorMessage(500)).toContain('(500)')
  })
})
