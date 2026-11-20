/**
 * The workspace a person gets for signing up, made on their first request
 * by the `team` middleware.
 */
import { describe, expect, test } from 'bun:test'
import { signupWorkspaceUuid, workspaceName, workspaceNameCandidates } from '../../app/Support/signupWorkspace'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

describe('the workspace name', () => {
  test('is the first name, or a plain default', () => {
    expect(workspaceName('Ada Lovelace')).toBe('Ada\'s workspace')
    expect(workspaceName('  José  María ')).toBe('José\'s workspace')
    for (const value of ['', '   ', null, undefined, '<>'])
      expect(workspaceName(value)).toBe('My workspace')
  })

  test('carries no markup', () => {
    expect(workspaceName('<b>Eve</b>')).toBe('bEveb\'s workspace')
  })

  test('a taken name has others to try, within the column', () => {
    expect(workspaceNameCandidates('Ada\'s workspace', 'abc12345')).toEqual(['Ada\'s workspace', 'Ada\'s workspace 2', 'Ada\'s workspace 3', 'Ada\'s workspace abc12345'])
    for (const name of workspaceNameCandidates('x'.repeat(120), 'abc12345'))
      expect(name.length).toBeLessThanOrEqual(100)
  })
})

describe('one workspace per person', () => {
  test('its uuid is the same every time, so two first requests make one', () => {
    expect(signupWorkspaceUuid(7)).toBe(signupWorkspaceUuid(7))
    expect(signupWorkspaceUuid(7)).not.toBe(signupWorkspaceUuid(8))
    expect(signupWorkspaceUuid(7)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('the team middleware makes it when the person belongs to no workspace', async () => {
    const middleware = await source('app/Middleware/Team.ts')
    expect(middleware).toContain('let membership = await activeTeam(request as any)')
    expect(middleware).toContain('if (!membership) {\n      const made = await ensureSignupWorkspace(')
  })

  test('members, suspended members and invited people get none', async () => {
    const code = await source('app/Support/signupWorkspace.ts')
    expect(code).toContain('if (await hasMembership(userId))\n    return { outcome: \'member\', teamId: null }')
    expect(code).toContain('if (await hasPendingInvitation(user.email, now))\n    return { outcome: \'invited\', teamId: null }')
    expect(code).toMatch(/async function hasMembership[^}]*\.where\('user_id' as any, '=', userId\)\n\s*\.executeTakeFirst\(\)/)
  })
})
