/**
 * How an automation runs: what can be turned on, what starts a run, and the
 * checks every email passes.
 *
 * The job and its trigger touch the database, so most of what is held here
 * is the rules (pure functions) and the shape of the code that applies
 * them. The chain itself was run end to end against a local mail sink.
 */
import { describe, expect, test } from 'bun:test'
import { MAX_SEND_ATTEMPTS, SEND_BACKOFF_MINUTES } from '../../app/Jobs/ProcessAutomationRun'
import { canonicalGraph, graphChecksum, messageHtml, readRunnableGraph, runIdempotencyKey, triggerType } from '../../app/Support/automationGraph'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

const graph = (nodes: unknown[], sender: unknown = 2) => JSON.stringify({ sender_identity_id: sender, nodes, edges: [] })
const mail = (id: string, subject = 'Hi', body = 'Hello.') => ({ id, type: 'send_email', config: { subject, body } })
const wait = (id: string, seconds: number) => ({ id, type: 'delay', config: { seconds } })

describe('what can be turned on', () => {
  test('emails and waits, from a sender, ending on an email', () => {
    const { graph: read, error } = readRunnableGraph(graph([mail('a', '  Welcome  aboard ', '\nHello.\n'), wait('b', 3600), mail('c')]))
    expect(error).toBe('')
    expect(read).toEqual({ senderIdentityId: 2, steps: [{ id: 'a', type: 'send_email', config: { subject: 'Welcome aboard', body: 'Hello.' } }, { id: 'b', type: 'delay', config: { seconds: 3600 } }, { id: 'c', type: 'send_email', config: { subject: 'Hi', body: 'Hello.' } }] })
  })

  test('every refusal names the step and the reason', () => {
    const cases: Array<[unknown, string]> = [
      [null, 'no steps'],
      ['not json', 'no steps'],
      [graph([mail('a')], 0), 'Choose the sender'],
      [graph([mail('a')], 'two'), 'Choose the sender'],
      [graph([]), 'no steps'],
      [graph([mail('a'), mail('a')]), 'Step 2 has a missing or repeated id'],
      [graph([mail('Has Spaces')]), 'Step 1 has a missing or repeated id'],
      [graph([mail('a', '')]), 'Step 1 needs a subject'],
      [graph([mail('a', 'Hi', ' ')]), 'Step 1 needs a message'],
      [graph([mail('a', 'x'.repeat(201))]), 'at most 200'],
      [graph([wait('a', 59 * 60), mail('b')]), 'between 1 hour and 30 days'],
      [graph([wait('a', 31 * 86_400), mail('b')]), 'between 1 hour and 30 days'],
      [graph([wait('a', 3600.5), mail('b')]), 'between 1 hour and 30 days'],
      [graph([{ id: 'a', type: 'approval', config: {} }, mail('b')]), 'Step 1 is a kind of step that cannot run yet'],
      [graph([{ id: 'a', type: 'send_sms', config: {} }]), 'Step 1 is a kind of step that cannot run yet'],
      [graph([wait('a', 3600)]), 'at least one email step'],
      [graph([mail('a'), wait('b', 3600)]), 'The last step cannot be a wait'],
      [graph(Array.from({ length: 21 }, (_, i) => mail(`m-${i}`))), 'at most 20 steps'],
    ]
    for (const [value, reason] of cases) {
      const { graph: read, error } = readRunnableGraph(value)
      expect({ read, error: error.includes(reason) }).toEqual({ read: null, error: true })
    }
  })

  test('equal graphs share a checksum, so turning on again reuses the version', () => {
    const a = readRunnableGraph(graph([mail('a', 'Hi  there')])).graph!
    const b = readRunnableGraph(JSON.stringify({ edges: [], nodes: [mail('a', 'Hi there')], sender_identity_id: 2, extra: true })).graph!
    expect(graphChecksum(canonicalGraph(a))).toBe(graphChecksum(canonicalGraph(b)))
    const c = readRunnableGraph(graph([mail('a', 'Hi there!')])).graph!
    expect(graphChecksum(canonicalGraph(c))).not.toBe(graphChecksum(canonicalGraph(a)))
    // A version is itself a graph the runner can read back.
    expect(readRunnableGraph(canonicalGraph(a)).graph).toEqual(a)
  })

  test('the trigger is read from its document', () => {
    expect(triggerType('{"type":"subscriber_joined"}')).toBe('subscriber_joined')
    expect(triggerType({ type: ' subscriber_joined ' })).toBe('subscriber_joined')
    expect(triggerType('nope')).toBe('')
  })
})

describe('the email', () => {
  test('a message is text, never markup', () => {
    expect(messageHtml('Hi <b>there</b> & "you"\nsecond line\n\nNew paragraph')).toBe('<p>Hi &lt;b&gt;there&lt;/b&gt; &amp; &quot;you&quot;<br>second line</p>\n<p>New paragraph</p>')
  })

  test('every send checks consent, the verified sender and quota, and carries an unsubscribe link', async () => {
    const job = await source('app/Jobs/ProcessAutomationRun.ts')
    expect(job).toContain("if (contact.status !== 'active' || !await consentAllows(teamId, 'email', address)) {")
    expect(job).toContain('const sender = await verifiedSender(teamId, senderIdentityId)')
    expect(job).toContain("await assertQuota(teamId, 'email', 1)")
    expect(job).toContain('withUnsubscribe(messageHtml(step.config.body), step.config.body,')
    // The same consent and quota rules campaigns use, from one place.
    expect(await source('app/Jobs/DispatchCampaign.ts')).toContain("import { assertQuota, consentAllows } from '../Support/emailDelivery'")
  })

  test('a sender counts only while it and its domain are verified', async () => {
    const runner = await source('app/Support/automationRunner.ts')
    expect(runner).toContain(".where('channel' as any, '=', 'email')\n    .where('status' as any, '=', 'verified')")
    expect(runner).toContain(".from('sender_domains' as any)".replace('.from', '.selectFrom'))
    expect(runner).toContain(".where('domain' as any, '=', domain)\n    .where('status' as any, '=', 'verified')")
  })
})

describe('starting and resuming runs', () => {
  test('one run per automation per contact, ever', () => {
    expect(runIdempotencyKey(4, 'subscriber_joined', 91)).toBe('automation:4:subscriber_joined:contact:91')
  })

  test('a confirmed signup starts runs, from both ways a signup is confirmed', async () => {
    expect(await source('app/Actions/Public/ConfirmSubscriptionAction.ts')).toContain("await startAutomations(payload.teamId, 'subscriber_joined', Number(contact.id))")
    const subscribe = await source('app/Actions/Public/SubscribeAction.ts')
    expect(subscribe).toContain("if (!form.doubleOptIn)\n      await startAutomations(teamId, 'subscriber_joined', Number(contact.id))")
  })

  test('starting a run never fails the signup that caused it', async () => {
    const runner = await source('app/Support/automationRunner.ts')
    const body = runner.slice(runner.indexOf('export async function startAutomations'))
    expect(body.indexOf('try {')).toBeLessThan(body.indexOf('selectFrom'))
    expect(body).toContain("log.error(`[automation] could not start ${trigger} runs")
  })

  test('only an admin or owner turns an automation on', async () => {
    const publish = await source('app/Actions/Api/V1/Automations/PublishAutomationAction.ts')
    expect(publish).toContain("if (!canEditWorkspace(membership?.role)) return response.json({ error: 'Turning an automation on requires an admin or owner role' }, 403)")
    expect(publish.indexOf('readRunnableGraph(')).toBeLessThan(publish.indexOf("insertInto('automation_versions'"))
    expect(publish.indexOf('verifiedSender(')).toBeLessThan(publish.indexOf("insertInto('automation_versions'"))
  })

  test('a run is claimed before anything is sent, so it is worked once', async () => {
    const job = await source('app/Jobs/ProcessAutomationRun.ts')
    expect(job).toContain(".where('status' as any, 'in', ['queued', 'waiting'])\n      .executeTakeFirst()")
    expect(job.indexOf('claimed')).toBeLessThan(job.indexOf('sendEmail(teamId'))
    // It never throws to be retried by the queue; its own backoff retries.
    expect(job).toContain('tries: 1,')
  })

  test('failed sends back off, and give up after the last attempt', () => {
    expect(SEND_BACKOFF_MINUTES).toEqual([5, 30, 120, 720])
    expect(MAX_SEND_ATTEMPTS).toBe(5)
  })

  test('the resume job runs every minute', async () => {
    expect(await source('app/Scheduler.ts')).toContain("schedule\n    .job('ResumeAutomationRuns')\n    .everyMinute()")
  })
})
