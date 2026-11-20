/**
 * Switching between workspaces.
 *
 * The rules that matter: the app's own actions and the generated model routes
 * pick the open workspace the same way; only a workspace the person actively
 * belongs to can be chosen; switching does not itself need a workspace; and
 * the menu never offers the open workspace as a switch.
 */
import { describe, expect, test } from 'bun:test'
import { teamRequest } from '../../app/Support/activeTeam'
import { requestedWorkspaceId, secureCookies } from '../../app/Support/workspaceSwitch'
import { roleLabel, switchErrorMessage, toWorkspaceMenu } from '../../resources/data/workspace-switch'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

function headers(values: Record<string, string>) {
  return { headers: { get: (name: string) => values[name.toLowerCase()] ?? null } }
}

describe('one answer for the open workspace', () => {
  test('the app\'s actions use the framework\'s resolver, as the model routes do', async () => {
    const helper = await source('app/Support/activeTeam.ts')
    expect(helper).toContain('await resolveAuthenticatedMembership(teamRequest(request as any))')
    expect(helper).not.toContain('orderBy(')
    expect(await source('app/Middleware/Team.ts')).toContain('let membership = await activeTeam(request as any)')
  })

  test('the request is read from its headers: the bearer token and the active_team cookie', () => {
    const request = teamRequest(headers({ authorization: 'Bearer abc.def', cookie: 'x=1; active_team=7; token=zz' }))
    expect(request.bearerToken?.()).toBe('abc.def')
    expect(request.cookies?.get('active_team')).toBe('7')
    expect(request.cookies?.get('missing')).toBeNull()
    expect(teamRequest(headers({ cookie: 'active_team=%E0%A4%A' })).cookies?.get('active_team')).toBeNull()
    expect(teamRequest({}).bearerToken?.()).toBeNull()
  })
})

describe('switching', () => {
  test('only a positive whole id is read', () => {
    expect(requestedWorkspaceId(3)).toBe(3)
    expect(requestedWorkspaceId('12')).toBe(12)
    for (const value of [0, -1, 1.5, '1.5', 'abc', '', null, undefined, '1; drop', Number.MAX_VALUE])
      expect(requestedWorkspaceId(value)).toBeNull()
  })

  test('only one of the person\'s own active workspaces can be chosen, and anything else is not found', async () => {
    const action = await source('app/Actions/Api/V1/SwitchWorkspaceAction.ts')
    expect(action).toContain('const workspace = (await memberWorkspaces(Number(user.id))).find(item => item.id === id)')
    expect(action).toContain('if (!workspace) return response.json({ error: \'Workspace not found\' }, 404)')
    expect(await source('app/Support/workspaceSwitch.ts')).toContain('.where(\'status\' as any, \'=\', \'active\')')
  })

  test('switching is not behind the team middleware, and is rate limited', async () => {
    const routes = await source('routes/api.ts')
    expect(routes).toContain('route.post(\'/v1/workspaces/active\', \'Actions/Api/V1/SwitchWorkspaceAction\').middleware(\'auth\').rateLimit(30, \'minute\')')
  })

  test('the cookie is Secure whenever the site is https', () => {
    expect(secureCookies('https://commshq.org')).toBe(true)
    expect(secureCookies('http://localhost:3030')).toBe(false)
    expect(secureCookies('')).toBe(false)
  })
})

describe('the menu', () => {
  const body = { data: { activeId: 2, workspaces: [
    { id: 1, name: 'Acme', role: 'member' },
    { id: 2, name: 'Glenn\'s workspace', role: 'owner' },
    { id: 3, name: 'Beta', role: 'viewer' },
    { id: 0, name: 'Broken', role: 'owner' },
    { id: 4, name: '  ', role: 'owner' },
  ] } }

  test('names the open workspace and offers only the others', () => {
    expect(toWorkspaceMenu(body)).toEqual({
      activeName: 'Glenn\'s workspace',
      activeRoleLabel: 'Owner',
      others: [{ id: 1, name: 'Acme', roleLabel: 'Member' }, { id: 3, name: 'Beta', roleLabel: 'Viewer' }],
      canSwitch: true,
    })
  })

  test('with one workspace there is nothing to switch to', () => {
    expect(toWorkspaceMenu({ data: { activeId: 2, workspaces: [{ id: 2, name: 'Solo', role: 'owner' }] } })).toMatchObject({ activeName: 'Solo', canSwitch: false, others: [] })
    expect(toWorkspaceMenu(null)).toMatchObject({ activeName: '', canSwitch: false })
  })

  test('roles and failures read as words', () => {
    expect(roleLabel('admin')).toBe('Admin')
    expect(roleLabel('nonsense')).toBe('')
    expect(switchErrorMessage(404)).toBe('You no longer belong to that workspace.')
    expect(switchErrorMessage(500)).toBe('That workspace could not be opened. Try again.')
  })

  test('the switcher sits in the rail and in the phone menu', async () => {
    const nav = await source('resources/components/CommsHQ/DashboardNavigation.stx')
    expect(nav.match(/<WorkspaceSwitcher \/>/g)?.length).toBe(2)
  })
})
