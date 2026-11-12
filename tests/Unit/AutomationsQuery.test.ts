/**
 * The automations list, the rows it turns into, and the create body.
 *
 * The load-bearing rule is a refusal: this page never sets an automation
 * `active`. Nothing starts a run and nothing publishes a version, so an
 * active row would look live and do nothing. The tests below also hold that
 * premise to the code, so the rule is revisited the day it stops being true.
 */
import { describe, expect, test } from 'bun:test'
import { automationNodes } from '../../app/Support/automationFlow'
import {
  automationPayload,
  AUTOMATION_NAME_MAX,
  AUTOMATIONS_ENDPOINT,
  AUTOMATIONS_PER_PAGE,
  automationsUrl,
  automationUrl,
  DEFAULT_TRIGGER_TYPE,
  draftError,
  EMPTY_GRAPH,
  listErrorMessage,
  saveErrorMessage,
  SETTABLE_STATUSES,
  statusLabel,
  statusPayload,
  stepCount,
  toAutomationView,
  toAutomationViews,
  triggerLabel,
} from '../../resources/data/automations-query'

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

async function sourcesUnder(pattern: string): Promise<string[]> {
  const root = new URL('../../', import.meta.url).pathname
  const files = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root, absolute: true, onlyFiles: true }))
  return Promise.all(files.map(file => Bun.file(file).text()))
}

describe('the requests', () => {
  test('it lists from the endpoint the framework model publishes, by name then id', () => {
    expect(AUTOMATIONS_ENDPOINT).toBe('/api/automations')
    expect(params(automationsUrl())).toEqual({ per_page: String(AUTOMATIONS_PER_PAGE), sort: 'name,id' })
  })

  test('status is an equality filter, and an empty one is not sent', () => {
    expect(params(automationsUrl({ status: 'archived', page: 2 }))).toMatchObject({ status: 'archived', page: '2' })
    expect(params(automationsUrl({ status: '' }))).not.toHaveProperty('status')
    expect(automationUrl(9)).toBe('/api/automations/9')
  })

  test('the framework model is named in the API selection, or the list is a 404', async () => {
    const security = await Bun.file(new URL('../../config/security.ts', import.meta.url)).text()
    expect(security).toMatch(/models:\s*\[[^\]]*'own'[^\]]*'Automation'/)
  })
})

describe('why nothing here switches an automation on', () => {
  test('the page may set draft, paused and archived, never active', () => {
    expect([...SETTABLE_STATUSES]).toEqual(['draft', 'paused', 'archived'])
    expect(statusPayload('archived')).toEqual({ status: 'archived' })
    expect(statusPayload('active')).toBeNull()
    expect(statusPayload('anything')).toBeNull()
  })

  test('still true: no application code starts a run or publishes a version', async () => {
    // When either of these fails, something now creates runs or versions,
    // and the page's refusal to activate should be looked at again.
    const sources = [...await sourcesUnder('app/{Actions,Jobs,Listeners,Support}/**/*.ts'), ...await sourcesUnder('routes/*.ts')]
    for (const source of sources) {
      expect(source).not.toMatch(/AutomationRun\.(?:create|forceCreate)\(/)
      expect(source).not.toMatch(/AutomationVersion\.(?:create|forceCreate)\(/)
    }
  })
})

describe('a row on the list', () => {
  test('a draft shows its trigger, its steps and that it was never published', () => {
    const graph = JSON.stringify({ nodes: [{ id: 'wait', type: 'delay' }, { id: 'hello', type: 'send_email' }], edges: [] })
    const view = toAutomationView({ id: 1, name: 'New subscriber welcome', status: 'draft', trigger: '{"type":"subscriber_joined"}', graph, updated_at: '2026-11-10T09:00:00Z' }, 'en-US')
    expect(view).toMatchObject({
      name: 'New subscriber welcome',
      statusLabel: 'Draft',
      triggerLabel: 'When a subscriber joins',
      stepsLabel: '2 steps',
      publishedLabel: 'Never published',
      updatedLabel: 'Nov 10, 2026',
      canPause: false,
      canArchive: true,
      canRestore: false,
    })
  })

  test('steps are counted the way the job reads them', () => {
    const graphs = [
      { nodes: [{ id: 1, type: 'delay' }, { id: 'a', type: 'approval' }, { type: 'no-id' }, { id: {}, type: 'x' }, { id: 'b' }, null] },
      JSON.stringify({ nodes: [{ id: 'only', type: 'send_sms' }] }),
      { nodes: [] },
      {},
      null,
    ]
    for (const graph of graphs)
      expect(stepCount(graph)).toBe(automationNodes(graph).length)
    expect(stepCount('not json')).toBe(0)
    expect(toAutomationView({ id: 2, graph: graphs[1] }).stepsLabel).toBe('1 step')
    expect(toAutomationView({ id: 2, graph: EMPTY_GRAPH }).stepsLabel).toBe('No steps yet')
  })

  test('a trigger nobody named reads as words, and a missing one is said', () => {
    expect(triggerLabel({ type: 'purchase_completed' })).toBe('On purchase completed')
    expect(triggerLabel('{}')).toBe('No trigger set')
    expect(triggerLabel('not json')).toBe('No trigger set')
    expect(triggerLabel(null)).toBe('No trigger set')
  })

  test('an active row can be stood down, an archived one restored', () => {
    expect(toAutomationView({ id: 3, status: 'active', published_at: '2026-11-01T00:00:00Z' }, 'en-US')).toMatchObject({ canPause: true, canArchive: true, canRestore: false, publishedLabel: 'Published Nov 1, 2026' })
    expect(toAutomationView({ id: 3, status: 'archived' })).toMatchObject({ canPause: false, canArchive: false, canRestore: true })
  })

  test('labels cover the unknown and the missing', () => {
    expect(statusLabel('paused')).toBe('Paused')
    expect(statusLabel(null)).toBe('Unknown')
    expect(toAutomationView({ id: 4, name: ' ' }).name).toBe('Automation 4')
    expect(toAutomationViews(null)).toEqual([])
  })
})

describe('creating one', () => {
  test('the name is held to the model limit', () => {
    expect(draftError({ name: 'Welcome series' })).toBe('')
    expect(draftError({ name: 'ab' })).toContain('at least 3')
    expect(draftError({ name: 'n'.repeat(AUTOMATION_NAME_MAX + 1) })).toContain(`at most ${AUTOMATION_NAME_MAX}`)
  })

  test('the body is a draft at version 1 with the fields the model requires', () => {
    expect(automationPayload({ name: ' Welcome series ' })).toEqual({
      name: 'Welcome series',
      status: 'draft',
      version: 1,
      trigger: JSON.stringify({ type: DEFAULT_TRIGGER_TYPE }),
      graph: EMPTY_GRAPH,
    })
    expect(automationNodes(EMPTY_GRAPH)).toEqual([])
  })
})

describe('what it says back', () => {
  test('each failure names what happened', () => {
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(503)).toContain('not answering')
    expect(listErrorMessage(418)).toContain('(418)')
    expect(saveErrorMessage(422)).toContain('invalid')
    expect(saveErrorMessage(404)).toContain('no longer exists')
    expect(saveErrorMessage(500)).toContain('(500)')
  })
})
