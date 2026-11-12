/**
 * The setup page: a step is done only when the workspace's own tables say so.
 *
 * The page it replaces told every account it was 63% set up. The rule here
 * is that nothing is shown as done unless the server answered `true` for it,
 * and that the page and the server agree on what the steps are.
 */
import { describe, expect, test } from 'bun:test'
import { SETUP_STEPS as SERVER_STEPS } from '../../app/Support/workspaceSetup'
import { SETUP_ENDPOINT, SETUP_STEPS, setupErrorMessage, toSetupView } from '../../resources/data/setup-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

const NONE = Object.fromEntries(SETUP_STEPS.map(step => [step.key, false]))
const ALL = Object.fromEntries(SETUP_STEPS.map(step => [step.key, true]))

describe('the steps', () => {
  test('the page lists exactly the steps the server answers for, in its order', () => {
    expect(SETUP_STEPS.map(step => step.key)).toEqual([...SERVER_STEPS])
  })

  test('every step leads to a dashboard page that exists', async () => {
    for (const step of SETUP_STEPS) {
      expect(step.href.startsWith('/dashboard/commshq/')).toBe(true)
      const page = step.href.split('/').pop()
      expect(await Bun.file(new URL(`../../resources/views/dashboard/commshq/${page}.stx`, import.meta.url)).exists()).toBe(true)
    }
  })

  test('it is read from the app route, behind auth and team', async () => {
    expect(SETUP_ENDPOINT).toBe('/api/v1/workspace/setup')
    expect(await source('routes/api.ts')).toContain("route.get('/v1/workspace/setup', 'Actions/Api/V1/WorkspaceSetupAction').middleware('auth').middleware('team')")
  })

  test('the server counts only what actually works', async () => {
    const setup = await source('app/Support/workspaceSetup.ts')
    // A pending domain, a draft form and a suspended member do not count.
    expect(setup).toContain("has('sender_domains', teamId, [['status', '=', 'verified']])")
    expect(setup).toContain("has('sender_identities', teamId, [['channel', '=', 'email'], ['status', '=', 'verified']])")
    expect(setup).toContain("has('form_definitions', teamId, [['status', '=', 'active']])")
    expect(setup).toContain("has('team_members', teamId, [['status', '=', 'active']], 2)")
    // Every question is scoped to the team that asked.
    expect(setup).toContain(".where('team_id' as any, '=', teamId)")
  })
})

describe('what the page shows', () => {
  test('a new workspace has nothing done, and the first step is next', () => {
    const view = toSetupView({ data: { steps: NONE } })
    expect(view).toMatchObject({ doneCount: 0, total: 8, complete: false, summary: '0 of 8 steps done.', percent: 0 })
    expect(view.steps.map(step => step.stateLabel)).toEqual(['Next', 'To do', 'To do', 'To do', 'To do', 'To do', 'To do', 'To do'])
    expect(view.steps[0]).toMatchObject({ number: 1, key: 'contacts', next: true, done: false })
  })

  test('next is the first step not done, even when later ones are', () => {
    const view = toSetupView({ data: { steps: { ...NONE, contacts: true, audience: true, campaign: true } } })
    expect(view.summary).toBe('3 of 8 steps done.')
    expect(view.percent).toBe(38)
    expect(view.steps.map(step => step.stateLabel)).toEqual(['Done', 'Done', 'Next', 'To do', 'Done', 'To do', 'To do', 'To do'])
    expect(view.steps.filter(step => step.next).map(step => step.key)).toEqual(['domain'])
  })

  test('a finished workspace says so and marks nothing as next', () => {
    const view = toSetupView({ data: { steps: ALL } })
    expect(view).toMatchObject({ doneCount: 8, complete: true, summary: 'All 8 steps are done.', percent: 100 })
    expect(view.steps.some(step => step.next)).toBe(false)
  })

  test('only a literal true counts as done', () => {
    const view = toSetupView({ data: { steps: { contacts: 'true', audience: 1, domain: null, sender: {}, campaign: true } } })
    expect(view.steps.filter(step => step.done).map(step => step.key)).toEqual(['campaign'])
    for (const body of [null, undefined, {}, { data: null }, { data: { steps: null } }])
      expect(toSetupView(body as never).doneCount).toBe(0)
  })

  test('each failure names what happened', () => {
    expect(setupErrorMessage(401)).toContain('Sign in again')
    expect(setupErrorMessage(403)).toContain('not an active member')
    expect(setupErrorMessage(503)).toContain('not answering')
    expect(setupErrorMessage(418)).toContain('(418)')
  })
})
