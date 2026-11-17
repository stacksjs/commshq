/**
 * How an automation runs: what can be turned on, what starts a run, and the
 * checks every email passes.
 *
 * The job and its trigger touch the database, so most of what is held here
 * is the rules (pure functions) and the shape of the code that applies
 * them. The chain itself was run end to end against a local mail sink.
 */
import { describe, expect, test } from 'bun:test'
import { contactTimezone, MAX_SEND_ATTEMPTS, QUIET_HOURS_RECHECK_MINUTES, SEND_BACKOFF_MINUTES } from '../../app/Jobs/ProcessAutomationRun'
import { canonicalGraph, graphChecksum, messageHtml, readRunnableGraph, runIdempotencyKey, triggerType, versionTrigger } from '../../app/Support/automationGraph'
import { ENROLL_LIMIT } from '../../app/Support/automationRunner'

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
      [graph([{ id: 'a', type: 'send_sms', config: {} }]), 'Step 1 needs a text'],
      [graph([{ id: 'a', type: 'send_sms', config: { body: 'x'.repeat(641) } }]), 'at most 640'],
      [graph([{ id: 'a', type: 'review', config: {} }]), 'Step 1 is a kind of step that cannot run yet'],
      [graph([wait('a', 3600)]), 'at least one message step'],
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
    expect(graphChecksum(canonicalGraph(a, 'subscriber_joined'))).toBe(graphChecksum(canonicalGraph(b, 'subscriber_joined')))
    const c = readRunnableGraph(graph([mail('a', 'Hi there!')])).graph!
    expect(graphChecksum(canonicalGraph(c, 'subscriber_joined'))).not.toBe(graphChecksum(canonicalGraph(a, 'subscriber_joined')))
    // A version is itself a graph the runner can read back.
    expect(readRunnableGraph(canonicalGraph(a, 'subscriber_joined')).graph).toEqual(a)
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
    expect(job).toContain("if (step.type === 'send_email' && (contact.status !== 'active' || !address || !await consentAllows(teamId, 'email', address))) {")
    expect(job).toContain('const sender = await verifiedSender(teamId, senderIdentityId)')
    expect(job).toContain("await assertQuota(teamId, 'email', 1)")
    expect(job).toContain('const message = withCartLink(messageHtml(step.config.body), step.config.body, cartUrl)')
    expect(job).toContain('withUnsubscribe(message.html, message.text,')
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

describe('texts', () => {
  test('an automation of texts and waits needs no sender', () => {
    const { graph: read, error } = readRunnableGraph(JSON.stringify({ nodes: [{ id: 't', type: 'send_sms', config: { body: ' Thanks! ' } }, wait('w', 3600), { id: 'u', type: 'send_sms', config: { body: 'Again.' } }] }))
    expect(error).toBe('')
    expect(read).toEqual({ senderIdentityId: 0, steps: [{ id: 't', type: 'send_sms', config: { body: 'Thanks!' } }, { id: 'w', type: 'delay', config: { seconds: 3600 } }, { id: 'u', type: 'send_sms', config: { body: 'Again.' } }] })
    // An email anywhere still needs one.
    expect(readRunnableGraph(JSON.stringify({ nodes: [{ id: 't', type: 'send_sms', config: { body: 'Hi' } }, mail('m')] })).error).toContain('Choose the sender')
  })

  test('a text checks a phone and SMS consent, waits out quiet hours, and counts against the SMS quota', async () => {
    const job = await source('app/Jobs/ProcessAutomationRun.ts')
    expect(job).toContain("if (contact.status !== 'active' || !phone || !await consentAllows(teamId, 'sms', phone)) {")
    expect(job).toContain('if (isWithinSmsQuietHours(new Date(), {')
    expect(job).toContain("await assertQuota(teamId, 'sms', segments)")
    // Without consent only the text is skipped, never the journey.
    expect(job).toContain("output: JSON.stringify({ skipped: phone ? 'no sms consent' : 'no phone number' }) })\n          continue")
  })

  test('a contact\'s own timezone is used when it is a real one', () => {
    expect(contactTimezone('{"timezone":"Asia/Manila"}')).toBe('Asia/Manila')
    expect(contactTimezone({ timezone: 'Mars/Olympus' })).toBe('UTC')
    expect(contactTimezone('not json')).toBe('UTC')
    expect(contactTimezone(null)).toBe('UTC')
    expect(QUIET_HOURS_RECHECK_MINUTES).toBe(30)
  })
})

describe('the trigger is part of the version', () => {
  test('changing the trigger changes the checksum, so it has to be put live', () => {
    const read = readRunnableGraph(graph([mail('a')])).graph!
    expect(graphChecksum(canonicalGraph(read, 'subscriber_joined'))).not.toBe(graphChecksum(canonicalGraph(read, 'purchase_made')))
    expect(versionTrigger(canonicalGraph(read, 'purchase_made'))).toBe('purchase_made')
    expect(versionTrigger(JSON.stringify({ nodes: [] }))).toBe('')
  })

  test('runs start from the live version\'s trigger, not the saved draft\'s', async () => {
    const runner = await source('app/Support/automationRunner.ts')
    expect(runner).toContain('if ((versionTrigger(version.graph) || triggerType(automation.trigger)) !== trigger)')
    expect(await source('app/Actions/Api/V1/Automations/PublishAutomationAction.ts')).toContain('const canonical = canonicalGraph(graph, trigger)')
  })
})

describe('enrolling people who already qualify', () => {
  test('only when asked, capped, queued rather than sent at once, and once per person', async () => {
    const publish = await source('app/Actions/Api/V1/Automations/PublishAutomationAction.ts')
    expect(publish).toContain("const enrolled = request.get('enroll_existing') === true")
    const runner = await source('app/Support/automationRunner.ts')
    expect(ENROLL_LIMIT).toBe(5000)
    expect(runner).toContain('for (const contactId of contactIds.slice(0, ENROLL_LIMIT)) {')
    expect(runner).toContain("status: 'queued',\n        version,")
    expect(runner).toContain('idempotency_key: runIdempotencyKey(automationId, trigger, contactId),')
  })

  test('a subscriber qualifies by their latest email consent, and a suppressed one never does', async () => {
    const runner = await source('app/Support/automationRunner.ts')
    expect(runner).toContain("return email !== '' && !suppressed.has(email) && ['confirmed', 'granted'].includes(latest.get(email) ?? '')")
    expect(runner).toContain(".orderBy('occurred_at' as any, 'asc')")
  })

  test('the count is a team-scoped route every member may read', async () => {
    expect(await source('routes/api.ts')).toContain("route.get('/v1/automations/{id}/qualifying', 'Actions/Api/V1/Automations/QualifyingContactsAction').middleware('auth').middleware('team')")
    expect(await source('app/Actions/Api/V1/Automations/QualifyingContactsAction.ts')).toContain(".where('id' as any, '=', id).where('team_id' as any, '=', teamId)")
  })
})
