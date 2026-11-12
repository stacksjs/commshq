/**
 * Workspace settings: the two fields a workspace has, and who may change them.
 *
 * Also holds a rule that renaming made necessary. Seeders run after every
 * deploy, and the owner seeder used to find the owner's workspace by its
 * default name; a renamed workspace would have been missed and a second one
 * created on each deploy.
 */
import { describe, expect, test } from 'bun:test'
import {
  canEditWorkspace,
  normalizeWorkspaceDescription,
  normalizeWorkspaceName,
  WORKSPACE_DESCRIPTION_MAX as SERVER_DESCRIPTION_MAX,
  WORKSPACE_NAME_MAX as SERVER_NAME_MAX,
  WORKSPACE_NAME_MIN as SERVER_NAME_MIN,
} from '../../app/Support/workspaceSettings'
import {
  isChanged,
  SETTINGS_ENDPOINT,
  settingsDraftError,
  settingsLoadError,
  settingsPayload,
  settingsSaveError,
  toSettingsView,
  WORKSPACE_DESCRIPTION_MAX,
  WORKSPACE_NAME_MAX,
  WORKSPACE_NAME_MIN,
} from '../../resources/data/settings-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

describe('what the server accepts', () => {
  test('a name is one line of 2 to 80 characters, with spaces tidied', () => {
    expect(normalizeWorkspaceName('  Sunday   Paper Co.  ')).toBe('Sunday Paper Co.')
    expect(normalizeWorkspaceName('ab')).toBe('ab')
    for (const value of ['', ' a ', 'n'.repeat(SERVER_NAME_MAX + 1), 'two\nlines', 'tab\there', null, undefined, 42])
      expect(normalizeWorkspaceName(value)).toBeUndefined()
  })

  test('a description is optional, short, and may hold a line break', () => {
    expect(normalizeWorkspaceDescription('  A weekly letter.  ')).toBe('A weekly letter.')
    expect(normalizeWorkspaceDescription('One.\nTwo.')).toBe('One.\nTwo.')
    expect(normalizeWorkspaceDescription('   ')).toBeNull()
    expect(normalizeWorkspaceDescription(undefined)).toBeNull()
    expect(normalizeWorkspaceDescription('d'.repeat(SERVER_DESCRIPTION_MAX + 1))).toBeUndefined()
    expect(normalizeWorkspaceDescription('bell\u0007')).toBeUndefined()
    expect(normalizeWorkspaceDescription(42)).toBeUndefined()
  })

  test('only owners and admins change them', () => {
    expect(['owner', 'Admin', 'member', 'viewer', null].map(role => canEditWorkspace(role))).toEqual([true, true, false, false, false])
  })

  test('the update acts on the caller\'s own workspace and reads two fields', async () => {
    const update = await source('app/Actions/Api/V1/UpdateWorkspaceSettingsAction.ts')
    expect(update).toContain('const teamId = membership.teamId')
    expect(update).not.toContain('getParam(')
    expect(update.match(/request\.get\(/g) ?? []).toHaveLength(2)
    expect(update).toContain('canEditWorkspace(membership.role)')
    const routes = await source('routes/api.ts')
    expect(routes).toContain("route.patch('/v1/workspace/settings', 'Actions/Api/V1/UpdateWorkspaceSettingsAction').middleware('auth').middleware('team')")
  })
})

describe('a renamed workspace is still the owner\'s', () => {
  test('the owner seeder looks for the workspace the owner owns before the default name', async () => {
    const seeder = await source('database/seeders/OwnerSeeder.ts')
    expect(seeder).toContain("let teamId = await ownedTeamId(userId) ?? await findId('teams', 'name', OWNER_WORKSPACE)")
    expect(seeder).toMatch(/async function ownedTeamId[\s\S]*\.where\('role' as any, '=', 'owner'\)/)
  })
})

describe('the page', () => {
  test('its limits are the server\'s', () => {
    expect([WORKSPACE_NAME_MIN, WORKSPACE_NAME_MAX, WORKSPACE_DESCRIPTION_MAX]).toEqual([SERVER_NAME_MIN, SERVER_NAME_MAX, SERVER_DESCRIPTION_MAX])
    expect(SETTINGS_ENDPOINT).toBe('/api/v1/workspace/settings')
  })

  test('it shows what was read, and edits only when told it may', () => {
    expect(toSettingsView({ data: { name: ' CommsHQ ', description: 'Owner workspace.', created_at: '2026-10-20T13:41:52.649Z', canEdit: true } }, 'en-US')).toEqual({ name: 'CommsHQ', description: 'Owner workspace.', canEdit: true, createdLabel: 'Workspace created Oct 20, 2026.' })
    expect(toSettingsView({ data: { name: 'CommsHQ', canEdit: 'yes' as never } }).canEdit).toBe(false)
    expect(toSettingsView(null)).toEqual({ name: '', description: '', canEdit: false, createdLabel: '' })
  })

  test('the form refuses what the endpoint would', () => {
    expect(settingsDraftError({ name: 'Sunday Paper Co.', description: '' })).toBe('')
    expect(settingsDraftError({ name: ' a ' })).toContain('at least 2')
    expect(settingsDraftError({ name: 'n'.repeat(WORKSPACE_NAME_MAX + 1) })).toContain(`at most ${WORKSPACE_NAME_MAX}`)
    expect(settingsDraftError({ name: 'Fine', description: 'd'.repeat(WORKSPACE_DESCRIPTION_MAX + 1) })).toContain(`at most ${WORKSPACE_DESCRIPTION_MAX}`)
    for (const name of ['  Sunday   Paper Co.  ', 'ab', 'x'.repeat(80)])
      expect(settingsPayload({ name }).name).toBe(normalizeWorkspaceName(name) ?? '')
  })

  test('Save has something to do only when a field changed', () => {
    const saved = { name: 'CommsHQ', description: 'Owner workspace.' }
    expect(isChanged({ name: ' CommsHQ ', description: 'Owner workspace.' }, saved)).toBe(false)
    expect(isChanged({ name: 'Sunday Paper Co.', description: 'Owner workspace.' }, saved)).toBe(true)
    expect(isChanged({ name: 'CommsHQ', description: '' }, saved)).toBe(true)
  })

  test('each failure names what happened', () => {
    expect(settingsLoadError(401)).toContain('Sign in again')
    expect(settingsLoadError(503)).toContain('not answering')
    expect(settingsSaveError(403)).toContain('owner or admin')
    expect(settingsSaveError(422)).toContain('rejected')
    expect(settingsSaveError(500)).toContain('(500)')
  })
})
