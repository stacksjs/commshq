/**
 * `buddy hq:connect commshq`: the keys an app is given, and what each may do.
 *
 * The package's contract suite runs first, against the same adapter the
 * routes use. The rest holds the rules that are CommsHQ's own: a send key is
 * one app's and nothing wider, mail leaves under an app's domain only once
 * the domain has said it may, and what is sent is counted, deduplicated and
 * kept from people who must not be written to.
 */
import type { OutgoingMessage } from '../../app/Hq/apps'
import { describe, expect, test } from 'bun:test'
import { createHqService, createMemoryConnectCodeStore } from '@stacksjs/hq/service'
import { hqServiceContract } from '@stacksjs/hq/testing'
import { addressOf, allowedHeaders, authenticateSendKey, ConnectRefusedError, createCommshqAdapter, registerSendingDomain, sendForApp, signupFormForApp, signupFormSlug, siteOrigin, upsertContactForApp, verifySendingDomain } from '../../app/Hq/apps'
import { signDkim, verifyDkim } from '@stacksjs/email'
import { bearerKey, hashAppKey, looksLikeAppKey, newAppKey } from '../../app/Hq/keys'
import { dkimAnswerMatches, recordsForApi, sendingDomainRecords } from '../../app/Hq/sendingDomain'
import { memoryAppStore } from '../fixtures/hq-memory-store'

const ALICE = { id: 1 }
const FALLBACK = 'no-reply@commshq.org'

function setup(options: Parameters<typeof memoryAppStore>[0] = {}) {
  const memory = memoryAppStore(options)
  const adapter = createCommshqAdapter({ store: memory.store, codes: createMemoryConnectCodeStore(), origin: () => 'https://commshq.test' })
  const sent: OutgoingMessage[] = []
  const dns = new Map<string, string[][]>()
  let canSign = true
  let transportOk = true

  const sendDeps = {
    store: memory.store,
    transport: async (message: OutgoingMessage) => {
      if (!transportOk)
        return { ok: false, error: 'connection refused' }
      sent.push(message)
      return { ok: true, messageId: `<${sent.length}@mail>` }
    },
    fallbackAddress: () => FALLBACK,
    canSign: () => canSign,
    newId: () => `msg-${sent.length + 1}`,
  }
  const domainDeps = {
    store: memory.store,
    lookupTxt: async (host: string) => ({ answer: dns.get(host) ?? [], failed: false }),
    fallbackFrom: (app: { name: string }) => `${app.name} via CommsHQ <${FALLBACK}>`,
    now: () => new Date('2026-11-16T00:00:00.000Z'),
  }

  /** Approve a connect as a user and return the app and its two keys. */
  async function connect(app = 'Votescape', user = ALICE) {
    const grant = await adapter.provision(user, { app }) as { project: { id: string, name: string }, ingestKey: string, readKey: string, dashboardUrl: string }
    const found = await authenticateSendKey(memory.store, grant.ingestKey)
    return { grant, app: found! }
  }

  /** Publish every record a domain was given, as its DNS would. */
  function publish(records: Array<{ name: string, content: string }>, only?: string[]): void {
    for (const record of records) {
      if (!only || only.some(part => record.name.includes(part)))
        dns.set(record.name, [[record.content.slice(0, 200), record.content.slice(200)].filter(Boolean)])
    }
  }

  /** An app whose domain is registered, published and verified. */
  async function readyApp(domain = 'votescape.org') {
    const { app, grant } = await connect()
    const registered = await registerSendingDomain(app, domain, domainDeps)
    if (!registered.ok)
      throw new Error(registered.error)
    publish(registered.data.records)
    await verifySendingDomain(app, domain, domainDeps)
    return { grant, app: (await authenticateSendKey(memory.store, grant.ingestKey))! }
  }

  return {
    ...memory,
    adapter,
    sent,
    dns,
    sendDeps,
    domainDeps,
    connect,
    publish,
    readyApp,
    signing: (value: boolean) => { canSign = value },
    mailServer: (value: boolean) => { transportOk = value },
  }
}

hqServiceContract('commshq', () => ({ adapter: setup().adapter, user: ALICE }))

describe('the keys', () => {
  test('a key says which kind it is, and only its own kind passes', () => {
    const send = newAppKey('send')
    const read = newAppKey('read')
    expect(looksLikeAppKey(send, 'send')).toBe(true)
    expect(looksLikeAppKey(send, 'read')).toBe(false)
    expect(looksLikeAppKey(read, 'send')).toBe(false)
    expect(looksLikeAppKey('chq_send_short', 'send')).toBe(false)
    expect(looksLikeAppKey(undefined, 'send')).toBe(false)
    expect(bearerKey(`Bearer ${send}`)).toBe(send)
    expect(bearerKey(`Basic ${send}`)).toBeNull()
  })

  test('only a hash is kept, and a revoked key opens nothing', async () => {
    const s = setup()
    const { grant } = await s.connect()
    expect(s.keys.map(key => key.hash)).not.toContain(grant.ingestKey)
    expect(JSON.stringify(s.keys)).not.toContain(grant.ingestKey.slice(9))
    expect(await authenticateSendKey(s.store, grant.ingestKey)).not.toBeNull()

    s.revoke(hashAppKey(grant.ingestKey))
    expect(await authenticateSendKey(s.store, grant.ingestKey)).toBeNull()
  })

  test('a read key cannot send, and a send key cannot read usage', async () => {
    const s = setup()
    const { grant } = await s.connect()
    expect(await authenticateSendKey(s.store, grant.readKey)).toBeNull()
    expect(await s.adapter.authenticateReadKey!(grant.ingestKey)).toBeNull()
    expect(await s.adapter.authenticateReadKey!(grant.readKey)).toEqual({ owner: '10', project: grant.project.id })
  })

  test('connecting again keeps the app and the keys already issued', async () => {
    const s = setup()
    const first = await s.connect()
    const second = await s.connect('votescape')
    expect(second.grant.project.id).toBe(first.grant.project.id)
    expect(second.grant.ingestKey).not.toBe(first.grant.ingestKey)
    // The first machine's deployment still sends.
    expect(await authenticateSendKey(s.store, first.grant.ingestKey)).not.toBeNull()
    expect(s.apps).toHaveLength(1)
  })

  test('only an admin or owner of a workspace may connect an app', async () => {
    const member = setup({ teams: { 1: { teamId: 10, role: 'member' } } })
    expect(member.adapter.provision(ALICE, { app: 'Votescape' })).rejects.toBeInstanceOf(ConnectRefusedError)
    expect(member.apps).toHaveLength(0)
    // A plain member is refused and is not given a workspace of their own to get round it.
    expect(member.workspaces).toHaveLength(0)
  })

  test('somebody with no workspace is given one, as its owner, and the connect carries on', async () => {
    const nobody = setup({ teams: {} })
    const { grant, app } = await nobody.connect()
    expect(nobody.workspaces).toEqual([{ teamId: app.teamId, userId: ALICE.id }])
    expect(await nobody.store.teamOf(ALICE.id)).toEqual({ teamId: app.teamId, role: 'owner' })
    expect(grant.project.name).toBe('Votescape')
    // It starts on an allowance, so its first send is not refused for having none.
    expect((await sendForApp(app, { to: 'a@example.com', subject: 'Hi', text: 'x' }, nobody.sendDeps)).ok).toBe(true)

    // Connecting again is the same workspace, not a second one.
    const again = await nobody.connect('Another app')
    expect(again.app.teamId).toBe(app.teamId)
    expect(nobody.workspaces).toHaveLength(1)
  })

  test('usage is the workspace\'s meters, read with the read key', async () => {
    const s = setup({ meters: { 10: { emails: { used: 40, limit: 100 }, contacts: { used: 5, limit: null } } } })
    const service = createHqService(s.adapter, { now: () => new Date('2026-11-16T00:00:00.000Z') })
    const { grant } = await s.connect()
    const response = await service.usage(new Request('http://x/api/v1/usage', { headers: { authorization: `Bearer ${grant.readKey}` } }))
    const reports = await response.json() as Array<{ meter: string, used: number, limit: number | null }>
    expect(reports.map(r => [r.meter, r.used, r.limit])).toEqual([['emails', 40, 100], ['contacts', 5, null]])
  })
})

describe('the sending domain', () => {
  test('registering gives the three records, inside the domain, and leaves it pending', async () => {
    const s = setup()
    const { app } = await s.connect()
    const result = await registerSendingDomain(app, ' Votescape.ORG. ', s.domainDeps)
    if (!result.ok)
      throw new Error(result.error)

    expect(result.data.status).toBe('pending')
    expect(result.data.from).toBe(`Votescape via CommsHQ <${FALLBACK}>`)
    expect(result.data.records.map(r => [r.purpose, r.name])).toEqual([
      ['ownership', '_commshq-verify.votescape.org'],
      ['dkim', 'commshq._domainkey.votescape.org'],
      ['dmarc', '_dmarc.votescape.org'],
    ])
    expect(result.data.records[1]!.content).toMatch(/^v=DKIM1; k=rsa; p=/)
    expect(result.data.records[2]!.content).toBe('v=DMARC1; p=none')
    // The private half is never in an answer.
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY')
  })

  test('asking again answers the same records: a deploy can ask every time', async () => {
    const s = setup()
    const { app } = await s.connect()
    const first = await registerSendingDomain(app, 'votescape.org', s.domainDeps)
    const again = await registerSendingDomain((await authenticateSendKey(s.store, (await s.connect()).grant.ingestKey))!, 'votescape.org', s.domainDeps)
    expect(again).toEqual(first)
    expect(s.domains).toHaveLength(1)
  })

  test('no request makes a domain verified: only its records in DNS do', async () => {
    const s = setup()
    const { app } = await s.connect()
    const registered = await registerSendingDomain(app, 'votescape.org', s.domainDeps)
    if (!registered.ok)
      throw new Error(registered.error)

    const nothing = await verifySendingDomain(app, 'votescape.org', s.domainDeps)
    expect(nothing).toMatchObject({ ok: true, data: { status: 'pending', checks: { ownership: false, dkim: false } } })

    // Ownership alone is not enough to send from the domain: its key must be there too.
    s.publish(registered.data.records, ['_commshq-verify'])
    const half = await verifySendingDomain(app, 'votescape.org', s.domainDeps)
    expect(half).toMatchObject({ ok: true, data: { status: 'pending', checks: { ownership: true, dkim: false } } })

    s.publish(registered.data.records)
    const whole = await verifySendingDomain(app, 'votescape.org', s.domainDeps)
    expect(whole).toMatchObject({ ok: true, data: { status: 'verified', from: 'noreply@votescape.org', checks: { ownership: true, dkim: true } } })
  })

  test('a key that is taken out of DNS stops the domain being used', async () => {
    const s = setup()
    const { app } = await s.readyApp()
    s.dns.delete('commshq._domainkey.votescape.org')
    const checked = await verifySendingDomain(app, 'votescape.org', s.domainDeps)
    expect(checked).toMatchObject({ ok: true, data: { status: 'pending', checks: { dkim: false } } })
  })

  test('another workspace\'s domain cannot be claimed, and DNS that cannot be asked proves nothing', async () => {
    const s = setup({ teams: { 1: { teamId: 10, role: 'owner' }, 2: { teamId: 20, role: 'owner' } }, meters: {} })
    const mine = await s.connect('Votescape', { id: 1 })
    const theirs = await s.connect('Other', { id: 2 })
    await registerSendingDomain(mine.app, 'votescape.org', s.domainDeps)
    expect(await registerSendingDomain(theirs.app, 'votescape.org', s.domainDeps)).toMatchObject({ ok: false, status: 409 })
    expect(await verifySendingDomain(theirs.app, 'votescape.org', s.domainDeps)).toMatchObject({ ok: false, status: 404 })

    const down = await verifySendingDomain(mine.app, 'votescape.org', { ...s.domainDeps, lookupTxt: async () => ({ answer: [], failed: true }) })
    expect(down).toMatchObject({ ok: false, status: 503 })
    expect(await registerSendingDomain(mine.app, 'not a domain', s.domainDeps)).toMatchObject({ ok: false, status: 422 })
  })

  test('the published key is recognised however DNS splits it, and the signature it makes verifies', async () => {
    const s = setup()
    await s.readyApp()
    const row = s.domains[0]!
    const dkim = recordsForApi(row.dnsRecords).find(r => r.purpose === 'dkim')!
    expect(dkimAnswerMatches([[dkim.content.slice(0, 100), dkim.content.slice(100)]], dkim.content)).toBe(true)
    expect(dkimAnswerMatches([['v=DKIM1; k=rsa; p=AAAA']], dkim.content)).toBe(false)

    const raw = 'From: Votescape <noreply@votescape.org>\r\nTo: a@example.com\r\nSubject: Hi\r\n\r\nhello\r\n'
    const signed = signDkim(raw, { domain: 'votescape.org', selector: 'commshq', privateKey: row.privateKey! })
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${dkim.content.split('p=')[1]!.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----\n`
    expect(verifyDkim(signed, publicKey)).toMatchObject({ ok: true, domain: 'votescape.org', selector: 'commshq' })
  })

  test('a domain added in the dashboard keeps its ownership record and gains a key', async () => {
    const s = setup()
    const { app } = await s.connect()
    const [ownership] = sendingDomainRecords('votescape.org', 'tok123', 'unused')
    s.domains.push({ id: 1, teamId: 10, domain: 'votescape.org', status: 'verified', dnsRecords: [{ type: 'TXT', host: ownership!.host, value: ownership!.value }], dkimVerifiedAt: null, privateKey: null })

    const result = await registerSendingDomain(app, 'votescape.org', s.domainDeps)
    if (!result.ok)
      throw new Error(result.error)
    expect(result.data.records[0]).toMatchObject({ purpose: 'ownership', content: 'commshq-verify=tok123' })
    expect(result.data.records[1]!.purpose).toBe('dkim')
    // Verified for the dashboard, but not yet somewhere an app can send from.
    expect(result.data.status).toBe('pending')
  })
})

describe('sending', () => {
  const MESSAGE = { from: { name: 'Votescape', address: 'noreply@votescape.org' }, to: 'reader@example.com', subject: 'Your results', text: 'Every county.' }

  test('until its domain is ready, mail goes out from CommsHQ under the app\'s name, with replies to the app', async () => {
    const s = setup()
    const { app } = await s.connect()
    const result = await sendForApp(app, MESSAGE, s.sendDeps)

    expect(result).toMatchObject({ ok: true, status: 202, data: { authenticated: 'fallback', from: `Votescape via CommsHQ <${FALLBACK}>`, accepted: ['reader@example.com'] } })
    expect(s.sent[0]).toMatchObject({ from: { name: 'Votescape via CommsHQ', address: FALLBACK }, replyTo: ['noreply@votescape.org'] })
    expect(s.sent[0]!.signing).toBeUndefined()
  })

  test('once it is ready, mail goes out from the app\'s own address, signed with the domain\'s key', async () => {
    const s = setup()
    const { app } = await s.readyApp()
    const result = await sendForApp(app, MESSAGE, s.sendDeps)

    expect(result).toMatchObject({ ok: true, data: { authenticated: 'domain', from: 'Votescape <noreply@votescape.org>' } })
    expect(s.sent[0]!.from).toEqual({ name: 'Votescape', address: 'noreply@votescape.org' })
    expect(s.sent[0]!.signing?.domain).toBe('votescape.org')
    expect(s.sent[0]!.signing?.privateKey).toContain('PRIVATE KEY')
    expect(s.sent[0]!.replyTo).toEqual([])
  })

  test('an address on another domain is never used, verified domain or not', async () => {
    const s = setup()
    const { app } = await s.readyApp()
    await sendForApp(app, { ...MESSAGE, from: { name: 'A bank', address: 'security@bank.example' } }, s.sendDeps)
    expect(s.sent[0]!.from).toEqual({ name: 'A bank via CommsHQ', address: FALLBACK })
    expect(s.sent[0]!.signing).toBeUndefined()

    // A subdomain of the app's own domain is the app's.
    await sendForApp(app, { ...MESSAGE, from: 'billing@mail.votescape.org' }, s.sendDeps)
    expect(s.sent[1]!.from.address).toBe('billing@mail.votescape.org')
  })

  test('where the mail driver cannot sign, nothing is sent from the app\'s domain', async () => {
    const s = setup()
    const { app } = await s.readyApp()
    s.signing(false)
    await sendForApp(app, MESSAGE, s.sendDeps)
    expect(s.sent[0]!.from.address).toBe(FALLBACK)
    expect(s.sent[0]!.signing).toBeUndefined()
  })

  test('what is sent is counted, and refused when the allowance is used up', async () => {
    const s = setup({ meters: { 10: { emails: { used: 98, limit: 100 } } } })
    const { app } = await s.connect()
    expect((await sendForApp(app, { ...MESSAGE, to: ['a@example.com', 'b@example.com'] }, s.sendDeps)).ok).toBe(true)
    expect(s.meters[10]!.emails!.used).toBe(100)

    const over = await sendForApp(app, MESSAGE, s.sendDeps)
    expect(over).toMatchObject({ ok: false, status: 402 })
    expect(s.sent).toHaveLength(1)
  })

  test('mail the server refused is not counted, and can be sent again under the same key', async () => {
    const s = setup()
    const { app } = await s.connect()
    s.mailServer(false)
    expect(await sendForApp(app, { ...MESSAGE, idempotencyKey: 'welcome:1' }, s.sendDeps)).toMatchObject({ ok: false, status: 502 })
    expect(s.meters[10]!.emails!.used).toBe(0)

    s.mailServer(true)
    expect(await sendForApp(app, { ...MESSAGE, idempotencyKey: 'welcome:1' }, s.sendDeps)).toMatchObject({ ok: true, status: 202 })
    expect(s.sent).toHaveLength(1)
  })

  test('the same idempotency key is the same message: sent once, answered twice', async () => {
    const s = setup()
    const { app } = await s.connect()
    const first = await sendForApp(app, { ...MESSAGE, idempotencyKey: 'receipt:42' }, s.sendDeps)
    const again = await sendForApp(app, { ...MESSAGE, idempotencyKey: 'receipt:42' }, s.sendDeps)
    expect(again).toMatchObject({ ok: true, status: 200, replayed: true })
    expect((again as any).data.id).toBe((first as any).data.id)
    expect(s.sent).toHaveLength(1)
    expect(s.meters[10]!.emails!.used).toBe(1)
    expect(await sendForApp(app, { ...MESSAGE, idempotencyKey: 'has spaces' }, s.sendDeps)).toMatchObject({ ok: false, status: 422 })
  })

  test('people who must not be written to are left out, and a message to nobody else is refused', async () => {
    const s = setup({ suppressed: { 10: ['gone@example.com'] } })
    const { app } = await s.connect()
    const mixed = await sendForApp(app, { ...MESSAGE, to: ['reader@example.com', 'gone@example.com'] }, s.sendDeps)
    expect(mixed).toMatchObject({ ok: true, data: { accepted: ['reader@example.com'], suppressed: ['gone@example.com'] } })
    expect(s.sent[0]!.to).toEqual(['reader@example.com'])
    expect(s.meters[10]!.emails!.used).toBe(1)

    expect(await sendForApp(app, { ...MESSAGE, to: 'gone@example.com' }, s.sendDeps)).toMatchObject({ ok: false, status: 422 })
    expect(s.sent).toHaveLength(1)
  })

  test('a message that is not one is refused before anything is counted', async () => {
    const s = setup()
    const { app } = await s.connect()
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ ...MESSAGE, to: undefined }, 422],
      [{ ...MESSAGE, to: 'not-an-address' }, 422],
      [{ ...MESSAGE, to: Array.from({ length: 51 }, (_, i) => `r${i}@example.com`) }, 422],
      [{ ...MESSAGE, subject: '' }, 422],
      [{ ...MESSAGE, subject: 'two\r\nBcc: x@example.com' }, 422],
      [{ ...MESSAGE, text: undefined }, 422],
      [{ ...MESSAGE, html: 'x'.repeat(500_001) }, 413],
    ]
    for (const [body, status] of cases)
      expect(await sendForApp(app, body, s.sendDeps)).toMatchObject({ ok: false, status })
    expect(s.sent).toHaveLength(0)
    expect(s.meters[10]!.emails!.used).toBe(0)
  })

  test('an app sends as itself and no other: one app\'s key never reaches another\'s domain', async () => {
    const s = setup({ teams: { 1: { teamId: 10, role: 'owner' }, 2: { teamId: 20, role: 'owner' } }, meters: { 10: { emails: { used: 0, limit: 10 } }, 20: { emails: { used: 0, limit: 10 } } } })
    await s.readyApp('votescape.org')
    const other = await s.connect('Other', { id: 2 })
    await sendForApp(other.app, MESSAGE, s.sendDeps)
    expect(s.sent[0]!.from.address).toBe(FALLBACK)
    expect(s.meters[20]!.emails!.used).toBe(1)
    expect(s.meters[10]!.emails!.used).toBe(0)
  })

  test('an address is read out of either form, and only headers an app may set are kept', () => {
    expect(addressOf('Reader <Reader@Example.com>')).toBe('reader@example.com')
    expect(addressOf({ address: 'a@b.co' })).toBe('a@b.co')
    expect(addressOf('a@b.co\r\nBcc: x@y.z')).toBeUndefined()
    expect(addressOf('nope')).toBeUndefined()
    expect(allowedHeaders({ 'X-Campaign': 'launch', 'List-Unsubscribe': '<https://x.test/u>', 'From': 'x@y.z', 'DKIM-Signature': 'v=1', 'X-Bad': 'a\r\nb', 'X-Num': 1 })).toEqual({ 'X-Campaign': 'launch', 'List-Unsubscribe': '<https://x.test/u>' })
  })
})

describe('contacts', () => {
  test('a contact is added once and updated after, in the app\'s own workspace', async () => {
    const s = setup({ audiences: { 10: ['aud-1'] } })
    const { app } = await s.connect()
    const created = await upsertContactForApp(app, { email: 'Reader@Example.com', firstName: 'Ada', audience: 'aud-1', properties: { plan: 'pro', nested: { no: 1 } } }, { store: s.store })
    expect(created).toMatchObject({ ok: true, status: 201, data: { email: 'reader@example.com', created: true, audience: true } })
    expect(s.contacts[0]!.input).toMatchObject({ source: 'app:Votescape', properties: { plan: 'pro' } })
    expect(s.contacts[0]!.teamId).toBe(10)
    expect(s.meters[10]!.contacts!.used).toBe(1)

    const updated = await upsertContactForApp(app, { email: 'reader@example.com', lastName: 'Lovelace' }, { store: s.store })
    expect(updated).toMatchObject({ ok: true, status: 200, data: { created: false } })
    expect(s.contacts).toHaveLength(1)
    expect(s.meters[10]!.contacts!.used).toBe(1)
  })

  test('an audience that is not the workspace\'s is not joined, and a bad address is refused', async () => {
    const s = setup({ audiences: { 20: ['aud-other'] } })
    const { app } = await s.connect()
    expect(await upsertContactForApp(app, { email: 'a@example.com', audience: 'aud-other' }, { store: s.store })).toMatchObject({ ok: true, data: { audience: false } })
    expect(s.memberships).toHaveLength(0)
    expect(await upsertContactForApp(app, { email: 'nope' }, { store: s.store })).toMatchObject({ ok: false, status: 422 })
  })
})

describe('an app\'s signup form', () => {
  const formDeps = (store: ReturnType<typeof setup>['store']) => ({ store, origin: () => 'https://commshq.test' })

  test('is made on first asking, with its audience, and is the same form every time after', async () => {
    const s = setup()
    const { app } = await s.connect()
    const first = await signupFormForApp(app, { origin: 'https://votescape.org' }, formDeps(s.store))
    if (!first.ok)
      throw new Error(first.error)
    expect(first.data.submitUrl).toBe(`https://commshq.test/forms/${first.data.id}/submit`)
    expect(first.data.audienceId).toBeTruthy()
    expect(s.forms).toHaveLength(1)
    expect(s.forms[0]).toMatchObject({ teamId: app.teamId, slug: signupFormSlug(app), name: 'Votescape signup', audienceName: 'Votescape subscribers', status: 'active' })
    expect(s.forms[0]!.document).toEqual({
      fields: [{ name: 'email', type: 'email', required: true }],
      listName: 'Votescape',
      successUrl: 'https://votescape.org/?subscribed=1',
      allowedOrigins: ['https://votescape.org'],
    })

    const again = await signupFormForApp(app, { origin: 'https://votescape.org/' }, formDeps(s.store))
    expect(again).toEqual(first)
    expect(s.forms).toHaveLength(1)
  })

  test('follows the app to a new origin, and keeps what the dashboard set', async () => {
    const s = setup()
    const { app } = await s.connect()
    await signupFormForApp(app, { origin: 'https://votescape.org', listName: 'Votescape news' }, formDeps(s.store))
    // Chosen in the dashboard since.
    s.forms[0]!.document.senderIdentityId = 7

    const moved = await signupFormForApp(app, { origin: 'https://www.votescape.org' }, formDeps(s.store))
    expect(moved.ok).toBe(true)
    expect(s.forms[0]!.document).toMatchObject({
      listName: 'Votescape news',
      senderIdentityId: 7,
      successUrl: 'https://www.votescape.org/?subscribed=1',
      allowedOrigins: ['https://www.votescape.org'],
    })
  })

  test('takes an https origin and nothing else', async () => {
    expect(siteOrigin('https://votescape.org')).toBe('https://votescape.org')
    expect(siteOrigin('https://Votescape.org/')).toBe('https://votescape.org')
    for (const bad of [undefined, '', 'votescape.org', 'http://votescape.org', 'https://votescape.org/about', 'https://votescape.org/?x=1', 'https://user:pw@votescape.org', 'https://localhost', 'javascript:alert(1)', 'ftp://votescape.org', ['https://votescape.org']])
      expect(siteOrigin(bad)).toBeUndefined()

    const s = setup()
    const { app } = await s.connect()
    expect(await signupFormForApp(app, { origin: 'http://votescape.org' }, formDeps(s.store))).toMatchObject({ ok: false, status: 422 })
    expect(await signupFormForApp(app, {}, formDeps(s.store))).toMatchObject({ ok: false, status: 422 })
    expect(s.forms).toHaveLength(0)
  })

  test('is one app\'s: another app, or another workspace, has a form of its own', async () => {
    const s = setup({ teams: { 1: { teamId: 10, role: 'owner' }, 2: { teamId: 20, role: 'owner' } } })
    const mine = await s.connect('Votescape')
    const sibling = await s.connect('Other app')
    const theirs = await s.connect('Votescape', { id: 2 })
    const forms = await Promise.all([mine, sibling, theirs].map(c => signupFormForApp(c.app, { origin: 'https://votescape.org' }, formDeps(s.store))))
    const ids = forms.map(f => (f.ok ? f.data.id : ''))
    expect(new Set(ids).size).toBe(3)
    expect(s.forms.map(f => f.teamId)).toEqual([10, 10, 20])
    // The key is what names the app: a read key is no app at all here.
    expect(await authenticateSendKey(s.store, mine.grant.readKey)).toBeNull()
  })

  test('does not bring back a form the dashboard archived', async () => {
    const s = setup()
    const { app } = await s.connect()
    await signupFormForApp(app, { origin: 'https://votescape.org' }, formDeps(s.store))
    s.forms[0]!.status = 'archived'
    expect(await signupFormForApp(app, { origin: 'https://votescape.org' }, formDeps(s.store))).toMatchObject({ ok: false, status: 409 })
    expect(s.forms[0]!.status).toBe('archived')
  })
})
