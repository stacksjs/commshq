/**
 * The automations page: rows, the step editor, and what it sends.
 *
 * The load-bearing rules: the page never sets `active` through the generated
 * update (turning on goes through publish, which checks the steps first);
 * the page's step rules are the server's, so it never says "ready" about
 * steps the server would refuse; and a step of a kind that cannot run is
 * kept, not silently deleted, until someone removes it.
 */
import { describe, expect, test } from 'bun:test'
import * as server from '../../app/Support/automationGraph'
import { automationNodes } from '../../app/Support/automationFlow'
import {
  activityLabel,
  ACTIVITY_ENDPOINT,
  automationPayload,
  AUTOMATION_NAME_MAX,
  AUTOMATIONS_ENDPOINT,
  AUTOMATIONS_PER_PAGE,
  automationsUrl,
  automationUrl,
  BODY_MAX,
  DEFAULT_TRIGGER_TYPE,
  draftError,
  EMPTY_GRAPH,
  graphPayload,
  listErrorMessage,
  MAX_DELAY_SECONDS,
  MAX_STEPS,
  MIN_DELAY_SECONDS,
  moveStep,
  newEmailStep,
  newSmsStep,
  newStepId,
  newWaitStep,
  publishErrorMessage,
  publishUrl,
  readinessError,
  saveErrorMessage,
  SETTABLE_STATUSES,
  statusLabel,
  statusPayload,
  stepCount,
  stepError,
  SUBJECT_MAX,
  toActivity,
  toAutomationView,
  toAutomationViews,
  toEditorSteps,
  triggerLabel,
  waitParts,
  waitSeconds,
  withFields,
} from '../../resources/data/automations-query'

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

const email = (subject: string, body: string) => withFields(newEmailStep([]), { subject, body })

describe('the requests', () => {
  test('it lists from the framework model\'s endpoint, by name then id', () => {
    expect(AUTOMATIONS_ENDPOINT).toBe('/api/automations')
    expect(params(automationsUrl())).toEqual({ per_page: String(AUTOMATIONS_PER_PAGE), sort: 'name,id' })
    expect(params(automationsUrl({ status: 'archived', page: 2 }))).toMatchObject({ status: 'archived', page: '2' })
    expect(params(automationsUrl({ status: '' }))).not.toHaveProperty('status')
    expect(automationUrl(9)).toBe('/api/automations/9')
  })

  test('the framework model is named in the API selection, or the list is a 404', async () => {
    expect(await source('config/security.ts')).toMatch(/models:\s*\[[^\]]*'own'[^\]]*'Automation'/)
  })

  test('turning on and activity are app routes behind auth and team', async () => {
    const routes = await source('routes/api.ts')
    expect(publishUrl(4)).toBe('/api/v1/automations/4/publish')
    expect(ACTIVITY_ENDPOINT).toBe('/api/v1/automations/activity')
    expect(routes).toContain("route.post('/v1/automations/{id}/publish', 'Actions/Api/V1/Automations/PublishAutomationAction').middleware('auth').middleware('team').rateLimit(20, 'minute')")
    expect(routes).toContain("route.get('/v1/automations/activity', 'Actions/Api/V1/Automations/AutomationActivityAction').middleware('auth').middleware('team')")
  })

  test('the generated update never sets active', () => {
    expect([...SETTABLE_STATUSES]).toEqual(['draft', 'paused', 'archived'])
    expect(statusPayload('archived')).toEqual({ status: 'archived' })
    expect(statusPayload('active')).toBeNull()
    expect(statusPayload('anything')).toBeNull()
  })
})

describe('the page and the server agree', () => {
  test('the same limits', () => {
    expect([MAX_STEPS, SUBJECT_MAX, BODY_MAX, MIN_DELAY_SECONDS, MAX_DELAY_SECONDS])
      .toEqual([server.MAX_STEPS, server.SUBJECT_MAX, server.BODY_MAX, server.MIN_DELAY_SECONDS, server.MAX_DELAY_SECONDS])
    expect(DEFAULT_TRIGGER_TYPE).toBe(server.TRIGGER_TYPES[0])
  })

  test('whatever the page calls ready, the server accepts, and the other way round', () => {
    const cases: Array<{ senderId: number, steps: ReturnType<typeof email>[] }> = [
      { senderId: 2, steps: [email('Welcome', 'Hello.'), newWaitStep([], 3, 'days'), withFields(email('Second', 'More.'), { id: 'email-2' })] },
      // Two steps with one id: the page never makes them, a graph saved elsewhere might.
      { senderId: 2, steps: [email('Welcome', 'Hello.'), email('Second', 'More.')] },
      { senderId: 0, steps: [email('Welcome', 'Hello.')] },
      { senderId: 2, steps: [] },
      { senderId: 2, steps: [newWaitStep([], 1, 'hours')] },
      { senderId: 2, steps: [email('Welcome', 'Hello.'), newWaitStep([], 1, 'days')] },
      { senderId: 2, steps: [email('', 'Hello.')] },
      { senderId: 2, steps: [email('Welcome', '   ')] },
      { senderId: 2, steps: [email('x'.repeat(201), 'Hello.')] },
      { senderId: 2, steps: [newWaitStep([], 31, 'days'), email('a', 'b')] },
      // Texts and waits need no sender; a text needs words, at most 640.
      { senderId: 0, steps: [newSmsStep([], 'Thanks!'), newWaitStep([], 1, 'days'), withFields(newSmsStep([]), { id: 'text-2', body: 'Again.' })] },
      { senderId: 0, steps: [newSmsStep([], 'Hi'), email('Welcome', 'Hello.')] },
      { senderId: 2, steps: [newSmsStep([], '   ')] },
      { senderId: 2, steps: [newSmsStep([], 'x'.repeat(641))] },
      { senderId: 2, steps: Array.from({ length: 21 }, (_, i) => withFields(newEmailStep([]), { id: `email-${i + 1}`, subject: 's', body: 'b' })) },
    ]
    for (const [index, { senderId, steps }] of cases.entries()) {
      const page = readinessError(senderId, steps)
      const { error } = server.readRunnableGraph(graphPayload(senderId, steps).graph)
      // The same verdict, about the same step. The words may differ.
      const step = (text: string) => text.match(/^Step (\d+)/)?.[1] ?? ''
      expect({ index, ready: page === '', step: step(page) }).toEqual({ index, ready: error === '', step: step(error) })
    }
  })

  test('a step of a kind that cannot run blocks both, and saving keeps it as it was', () => {
    const saved = JSON.stringify({ sender_identity_id: 2, nodes: [{ id: 'ask', type: 'approval', config: { reviewer: 7 } }, { id: 'hi', type: 'send_email', config: { subject: 'Hi', body: 'Hello.' } }] })
    const { senderId, steps } = toEditorSteps(saved)
    expect(steps.map(step => step.kind)).toEqual(['other', 'email'])
    expect(readinessError(senderId, steps)).toContain('Step 1 is a kind of step that cannot run yet')
    const payload = JSON.parse(graphPayload(senderId, steps, saved).graph)
    expect(payload.nodes[0]).toEqual({ id: 'ask', type: 'approval', config: { reviewer: 7 } })
    expect(server.readRunnableGraph(JSON.stringify(payload)).error).toContain('Step 1 is a kind of step that cannot run yet')
  })
})

describe('the editor', () => {
  test('a saved graph reads into steps, waits in their largest even unit', () => {
    const saved = { sender_identity_id: '3', nodes: [{ id: 'hello', type: 'send_email', config: { subject: 'Hi', body: 'Body' } }, { id: 'pause', type: 'delay', config: { seconds: 172_800 } }, { id: 'nudge', type: 'delay', config: { seconds: 7200 } }] }
    const { senderId, steps } = toEditorSteps(saved)
    expect(senderId).toBe(3)
    expect(steps.map(step => step.summary)).toEqual(['Send an email: Hi', 'Wait 2 days', 'Wait 2 hours'])
    expect(toEditorSteps(null)).toEqual({ senderId: 0, steps: [] })
    expect(waitParts(90_000)).toEqual({ amount: 25, unit: 'hours' })
    expect(waitSeconds(3, 'days')).toBe(259_200)
  })

  test('new steps get ids the server accepts and no other step uses', () => {
    const steps = [{ id: 'email-1' }, { id: 'email-2' }, { id: 'wait-1' }]
    expect(newStepId('email', steps)).toBe('email-3')
    expect(newStepId('wait', steps)).toBe('wait-2')
    expect(newStepId('email', [])).toMatch(/^[a-z0-9-]{1,60}$/)
  })

  test('one step is checked by the server\'s rules before it joins the list', () => {
    expect(stepError({ kind: 'email', subject: 'Hi', body: 'Hello', amount: 1, unit: 'days' })).toBe('')
    expect(stepError({ kind: 'email', subject: '  ', body: 'Hello', amount: 1, unit: 'days' })).toContain('subject')
    expect(stepError({ kind: 'email', subject: 'Hi', body: 'x'.repeat(BODY_MAX + 1), amount: 1, unit: 'days' })).toContain('at most 20,000')
    expect(stepError({ kind: 'wait', subject: '', body: '', amount: 1, unit: 'hours' })).toBe('')
    expect(stepError({ kind: 'wait', subject: '', body: '', amount: 30, unit: 'days' })).toBe('')
    expect(stepError({ kind: 'wait', subject: '', body: '', amount: 31, unit: 'days' })).toContain('between 1 hour and 30 days')
    expect(stepError({ kind: 'wait', subject: '', body: '', amount: 1.5, unit: 'days' })).toContain('whole number')
    expect(stepError({ kind: 'wait', subject: '', body: '', amount: 0, unit: 'days' })).toContain('whole number')
  })

  test('moving a step swaps it with its neighbour, and off the end is no change', () => {
    expect(moveStep(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveStep(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveStep(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
    expect(moveStep(['a'], -1, 1)).toEqual(['a'])
  })

  test('the saved graph trims what was typed and leaves out a missing sender', () => {
    const steps = [withFields(newEmailStep([]), { subject: '  Welcome   aboard ', body: '\nHello.\n' }), withFields(newWaitStep([{ id: 'email-1' }]), { amount: 2, unit: 'days' })]
    expect(JSON.parse(graphPayload(5, steps).graph)).toEqual({
      nodes: [{ id: 'email-1', type: 'send_email', config: { subject: 'Welcome aboard', body: 'Hello.' } }, { id: 'wait-1', type: 'delay', config: { seconds: 172_800 } }],
      edges: [],
      sender_identity_id: 5,
    })
    expect(JSON.parse(graphPayload(0, []).graph)).toEqual({ nodes: [], edges: [] })
  })
})

describe('a row on the list', () => {
  const activity = toActivity({
    data: [
      { automation_id: 1, version: 2, unpublished_changes: false, runs: { completed: 8, waiting: 3, cancelled: 1 }, emails_sent: 19 },
      { automation_id: 2, version: 1, unpublished_changes: true, runs: {}, emails_sent: 0 },
    ],
    can_publish: true,
  })

  test('an automation that is on says what it has done', () => {
    const view = toAutomationView({ id: 1, name: 'Welcome', status: 'active', published_at: '2026-11-01T00:00:00Z', trigger: '{"type":"subscriber_joined"}' }, activity.byId.get(1), true, 'en-US')
    expect(view).toMatchObject({ statusLabel: 'On', triggerLabel: 'When someone confirms a signup', publishedLabel: 'Version 2, turned on Nov 1, 2026', canPause: true, turnOnLabel: '', changesNote: '' })
    expect(view.activityLabel).toBe('12 people: 3 waiting, 8 finished, 1 stopped. 19 emails sent.')
  })

  test('turning on is offered by state, and only to someone allowed to', () => {
    expect(toAutomationView({ id: 9, status: 'draft' }, undefined, true).turnOnLabel).toBe('Turn on')
    expect(toAutomationView({ id: 1, status: 'paused' }, activity.byId.get(1), true).turnOnLabel).toBe('Resume')
    expect(toAutomationView({ id: 2, status: 'paused' }, activity.byId.get(2), true).turnOnLabel).toBe('Resume with changes')
    expect(toAutomationView({ id: 2, status: 'active' }, activity.byId.get(2), true)).toMatchObject({ turnOnLabel: 'Put changes live' })
    expect(toAutomationView({ id: 2, status: 'active' }, activity.byId.get(2), true).changesNote).toContain('differ from the live version')
    for (const status of ['draft', 'paused', 'active'])
      expect(toAutomationView({ id: 2, status }, activity.byId.get(2), false).turnOnLabel).toBe('')
    expect(toAutomationView({ id: 3, status: 'archived' }, undefined, true)).toMatchObject({ turnOnLabel: '', canEdit: false, canRestore: true, canArchive: false })
  })

  test('permission is only a literal true', () => {
    for (const body of [{ data: [] }, { data: [], can_publish: 'true' }, { data: [], can_publish: 1 }, null])
      expect(toActivity(body as any).canPublish).toBe(false)
  })

  test('a draft that was never turned on says so, and nobody started is said', () => {
    expect(toAutomationView({ id: 5, status: 'draft' })).toMatchObject({ publishedLabel: 'Never turned on', activityLabel: '' })
    expect(activityLabel({ automation_id: 1, runs: {}, emails_sent: 0 })).toBe('Nobody has started it yet.')
    expect(activityLabel({ automation_id: 1, runs: { running: 1 }, emails_sent: 1 })).toBe('1 person: 1 running. 1 email sent.')
  })

  test('steps are counted the way the job reads them', () => {
    const graphs = [{ nodes: [{ id: 1, type: 'delay' }, { type: 'no-id' }, null] }, JSON.stringify({ nodes: [{ id: 'only', type: 'send_sms' }] }), {}, null]
    for (const graph of graphs)
      expect(stepCount(graph)).toBe(automationNodes(graph).length)
    expect(toAutomationView({ id: 2, graph: EMPTY_GRAPH }).stepsLabel).toBe('No steps yet')
  })

  test('labels cover the unknown and the missing', () => {
    expect(triggerLabel({ type: 'purchase_completed' })).toBe('On purchase completed')
    expect(triggerLabel('not json')).toBe('No trigger set')
    expect(statusLabel(null)).toBe('Unknown')
    expect(toAutomationView({ id: 4, name: ' ' }).name).toBe('Automation 4')
    expect(toAutomationViews(null)).toEqual([])
  })
})

describe('creating one, and what it says back', () => {
  test('a new automation is an empty draft at version 1 with the one trigger', () => {
    expect(draftError({ name: 'ab' })).toContain('at least 3')
    expect(draftError({ name: 'n'.repeat(AUTOMATION_NAME_MAX + 1) })).toContain(`at most ${AUTOMATION_NAME_MAX}`)
    expect(automationPayload({ name: ' Welcome series ' })).toEqual({ name: 'Welcome series', status: 'draft', version: 1, trigger: JSON.stringify({ type: 'subscriber_joined' }), graph: EMPTY_GRAPH })
  })

  test('each failure names what happened, and a refusal to turn on gives the server\'s reason', () => {
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(saveErrorMessage(404)).toContain('no longer exists')
    expect(publishErrorMessage(422, 'Step 2 needs a message.')).toBe('It cannot be turned on yet. Step 2 needs a message.')
    expect(publishErrorMessage(403)).toContain('admin or owner')
    expect(publishErrorMessage(409)).toContain('Restore')
    expect(publishErrorMessage(500)).toContain('(500)')
  })

  test('the user-visible text has no em-dash or en-dash', async () => {
    const text = `${await source('resources/data/automations-query.ts')}${await source('resources/components/CommsHQ/AutomationBuilder.stx')}`
    expect(text).not.toMatch(/[—–]/)
  })
})
