/**
 * The SQL store behind `buddy hq:connect commshq`, run against a real
 * database: SQLite in memory, with this repository's own migrations applied.
 *
 * tests/Unit/HqConnect.test.ts holds the rules, against a store in memory.
 * This holds that the SQL says the same thing: the statements parse, the
 * migration creates what they read, a key is found by its hash and not after
 * it is revoked, a meter is counted only when it fits, and a domain's private
 * key comes back out of the table only under the application's key.
 */
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { authenticateSendKey, createCommshqAdapter, registerSendingDomain, sendForApp, signupFormForApp, upsertContactForApp, verifySendingDomain } from '../../app/Hq/apps'
import { hashAppKey } from '../../app/Hq/keys'
import { createSqlAppStore, workspaceName } from '../../app/Hq/sqlStore'
import { ensureOpenMeters, freeMeterAllowances, meterAllowances, METER_KEYS, monthOf } from '../../app/Support/usagePeriods'
import { confirmationCode, createHqService, createMemoryConnectCodeStore, sqlConnectCodeStore } from '@stacksjs/hq/service'

const MIGRATIONS = join(import.meta.dir, '..', '..', 'database', 'migrations')

/** A migration's statements, as the runner splits them. */
function statements(file: string): string[] {
  return readFileSync(join(MIGRATIONS, file), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    .split(';').map(statement => statement.trim()).filter(Boolean)
}

function migration(table: string): string {
  // The oldest of that name: a later file of the same name adds to the table the first one made.
  const file = readdirSync(MIGRATIONS).sort().find(name => name.endsWith(`-create-${table}-table.sql`))
  if (!file)
    throw new Error(`No migration creates ${table}`)
  return file
}

function database() {
  const db = new Database(':memory:')
  // The tables the store reads that were here before it, from their own migrations.
  for (const table of ['users', 'teams', 'team_members', 'usage_meters', 'contacts', 'communication_suppressions', 'audiences', 'sender_domains', 'form_definitions']) {
    for (const statement of statements(migration(table)))
      db.run(statement)
  }
  // And the five this feature adds, generated from their models.
  for (const table of ['connected_apps', 'app_keys', 'app_sends', 'sender_domain_keys', 'hq_connect_codes']) {
    for (const statement of statements(migration(table)))
      db.run(statement)
  }
  // And the columns added to them since, in the order they were added.
  for (const file of readdirSync(MIGRATIONS).sort().filter(name => /-alter-(?:connected_apps|app_sends)-columns\.sql$/.test(name))) {
    for (const statement of statements(file))
      db.run(statement)
  }

  const period = { start: '2026-11-01T00:00:00.000Z', end: '2099-12-01T00:00:00.000Z' }
  db.run('INSERT INTO teams (id, name) VALUES (10, \'Votescape\'), (20, \'Other\')')
  db.run('INSERT INTO team_members (team_id, user_id, role, status) VALUES (10, 1, \'owner\', \'active\'), (20, 2, \'owner\', \'active\'), (10, 3, \'member\', \'active\')')
  db.run('INSERT INTO usage_meters (team_id, key, quantity, included_quantity, period_start, period_end) VALUES (10, \'emails\', 0, 3, ?, ?), (10, \'contacts\', 0, NULL, ?, ?)', [period.start, period.end, period.start, period.end])
  db.run('INSERT INTO communication_suppressions (team_id, channel, recipient, reason, source, suppressed_at) VALUES (10, \'email\', \'gone@example.com\', \'bounce\', \'test\', ?)', [period.start])
  db.run('INSERT INTO audiences (id, uuid, team_id, name) VALUES (5, \'aud-1\', 10, \'Newsletter\')')

  const joined: string[] = []
  const store = createSqlAppStore({
    run: async (sql, params = []) => db.query(sql).all(...(params as any[])) as Record<string, unknown>[],
    appKey: () => 'app-key-for-tests',
    joinAudience: async (teamId, audienceId, contactId) => { joined.push(`${teamId}:${audienceId}:${contactId}`) },
  })
  return { db, store, joined }
}

function world() {
  const { db, store, joined } = database()
  const adapter = createCommshqAdapter({ store, codes: createMemoryConnectCodeStore(), origin: () => 'https://commshq.test' })
  const sent: any[] = []
  const dns = new Map<string, string[][]>()
  const sendDeps = {
    store,
    transport: async (message: any) => {
      sent.push(message)
      return { ok: true }
    },
    fallbackAddress: () => 'no-reply@commshq.org',
    canSign: () => true,
  }
  const domainDeps = {
    store,
    lookupTxt: async (host: string) => ({ answer: dns.get(host) ?? [], failed: false }),
    fallbackFrom: () => 'Votescape via CommsHQ <no-reply@commshq.org>',
  }
  async function connect(user = 1, app = 'Votescape') {
    const grant = await adapter.provision({ id: user }, { app }) as { project: { id: string }, ingestKey: string, readKey: string }
    return { grant, app: (await authenticateSendKey(store, grant.ingestKey))! }
  }
  return { db, store, adapter, sent, dns, sendDeps, domainDeps, connect, joined }
}

describe('the SQL store', () => {
  test('the migration creates every table the store reads, and only hashes of keys are in them', async () => {
    const w = world()
    const { grant, app } = await w.connect()
    expect(app).toMatchObject({ teamId: 10, name: 'Votescape', senderDomainId: null })

    const keys = w.db.query('SELECT kind, key_hash, hint FROM app_keys ORDER BY id').all() as Array<{ kind: string, key_hash: string, hint: string }>
    expect(keys.map(key => key.kind)).toEqual(['send', 'read'])
    expect(keys[0]!.key_hash).toBe(hashAppKey(grant.ingestKey))
    expect(JSON.stringify(keys)).not.toContain(grant.ingestKey.slice(14))
    expect(keys[0]!.hint).toBe(`${grant.ingestKey.slice(0, 14)}...`)
  })

  test('an app is found again by name whatever its case, a member cannot connect, and a revoked key opens nothing', async () => {
    const w = world()
    const first = await w.connect(1, 'Votescape')
    const again = await w.connect(1, 'VOTESCAPE')
    expect(again.grant.project.id).toBe(first.grant.project.id)
    expect(w.db.query('SELECT count(*) AS n FROM connected_apps').get()).toEqual({ n: 1 })
    expect(w.adapter.provision({ id: 3 }, { app: 'Votescape' })).rejects.toThrow('admin or owner')

    w.db.run('UPDATE app_keys SET revoked_at = ? WHERE key_hash = ?', [new Date().toISOString(), hashAppKey(first.grant.ingestKey)])
    expect(await authenticateSendKey(w.store, first.grant.ingestKey)).toBeNull()
    expect(await authenticateSendKey(w.store, again.grant.ingestKey)).not.toBeNull()
  })

  test('usage is the open period\'s meters, and a send is counted only while it fits', async () => {
    const w = world()
    const { grant, app } = await w.connect()
    const principal = await w.adapter.authenticateReadKey!(grant.readKey)
    // The two the workspace was given, and the three it never had a row for, opened on the free plan.
    expect(await w.adapter.usage!(principal!)).toEqual([
      { meter: 'ai_generations', used: 0, limit: 0 },
      { meter: 'contacts', used: 0, limit: null },
      { meter: 'custom_domains', used: 0, limit: 0 },
      { meter: 'emails', used: 0, limit: 3 },
      { meter: 'sms_segments', used: 0, limit: 0 },
    ])

    const message = { to: ['a@example.com', 'b@example.com'], subject: 'Hi', text: 'x' }
    expect((await sendForApp(app, message, w.sendDeps)).ok).toBe(true)
    // Two of three used: two more do not fit, and are not counted.
    expect(await sendForApp(app, message, w.sendDeps)).toMatchObject({ ok: false, status: 402 })
    expect((await sendForApp(app, { ...message, to: 'c@example.com' }, w.sendDeps)).ok).toBe(true)
    expect(w.db.query('SELECT quantity FROM usage_meters WHERE team_id = 10 AND key = \'emails\'').get()).toEqual({ quantity: 3 })
    expect(w.sent).toHaveLength(2)
  })

  test('a suppressed address is left out, and the same idempotency key is one row and one message', async () => {
    const w = world()
    const { app } = await w.connect()
    const first = await sendForApp(app, { to: ['reader@example.com', 'gone@example.com'], subject: 'Hi', text: 'x', idempotencyKey: 'receipt:1' }, w.sendDeps)
    expect(first).toMatchObject({ ok: true, data: { accepted: ['reader@example.com'], suppressed: ['gone@example.com'] } })

    const again = await sendForApp(app, { to: 'reader@example.com', subject: 'Hi', text: 'x', idempotencyKey: 'receipt:1' }, w.sendDeps)
    expect(again).toMatchObject({ ok: true, status: 200, replayed: true, data: { accepted: ['reader@example.com'], suppressed: ['gone@example.com'] } })
    expect(w.sent).toHaveLength(1)
    expect(w.db.query('SELECT count(*) AS n FROM app_sends').get()).toEqual({ n: 1 })
  })

  test('a domain is registered with its key sealed, verified from DNS, and then signs the app\'s mail', async () => {
    const w = world()
    const { app, grant } = await w.connect()
    const registered = await registerSendingDomain(app, 'votescape.org', w.domainDeps)
    if (!registered.ok)
      throw new Error(registered.error)

    const row = w.db.query('SELECT private_key_sealed, public_key FROM sender_domain_keys').get() as { private_key_sealed: string, public_key: string }
    expect(row.private_key_sealed.startsWith('v1.')).toBe(true)
    expect(row.private_key_sealed).not.toContain('PRIVATE KEY')
    expect(w.db.query('SELECT status, selector FROM sender_domains WHERE domain = \'votescape.org\'').get()).toEqual({ status: 'pending', selector: 'commshq' })

    for (const record of registered.data.records)
      w.dns.set(record.name, [[record.content]])
    const verified = await verifySendingDomain((await authenticateSendKey(w.store, grant.ingestKey))!, 'votescape.org', w.domainDeps)
    expect(verified).toMatchObject({ ok: true, data: { status: 'verified', from: 'noreply@votescape.org' } })

    const ready = (await authenticateSendKey(w.store, grant.ingestKey))!
    expect(ready.senderDomainId).not.toBeNull()
    await sendForApp(ready, { from: 'hello@votescape.org', to: 'a@example.com', subject: 'Hi', text: 'x' }, w.sendDeps)
    expect(w.sent[0].from.address).toBe('hello@votescape.org')
    expect(w.sent[0].signing.privateKey).toContain('BEGIN PRIVATE KEY')

    // Under another application key the stored key is unreadable, and the mail falls back.
    const stranger = createSqlAppStore({ run: async (sql, params = []) => w.db.query(sql).all(...(params as any[])) as any, appKey: () => 'another-key', joinAudience: async () => {} })
    expect(await stranger.domainPrivateKey(ready.senderDomainId!)).toBeNull()
  })

  test('what was sent, bounced and complained about is counted by the week, and a pause holds until lifted', async () => {
    const w = world()
    const { app } = await w.connect()
    const now = new Date()
    const before = await w.store.sendingCounts(app.id, app.teamId, now)
    expect(before).toMatchObject({ pausedReason: null, sentLastDay: 0, sentLastWeek: 0, firstSentAt: null })

    expect(await sendForApp(app, { to: ['a@example.com', 'b@example.com'], subject: 'Hi', text: 'x' }, w.sendDeps)).toMatchObject({ ok: true })
    const recent = now.toISOString()
    const old = new Date(now.getTime() - 30 * 86_400_000).toISOString()
    w.db.run('INSERT INTO communication_suppressions (team_id, channel, recipient, reason, source, suppressed_at) VALUES (10, \'email\', \'x@example.com\', \'bounce\', \'test\', ?), (10, \'email\', \'y@example.com\', \'complaint\', \'test\', ?), (10, \'email\', \'z@example.com\', \'bounce\', \'test\', ?), (20, \'email\', \'q@example.com\', \'bounce\', \'test\', ?)', [recent, recent, old, recent])

    const after = await w.store.sendingCounts(app.id, app.teamId, new Date(Date.now() + 1000))
    expect(after).toMatchObject({ sentLastDay: 2, sentLastWeek: 2, bouncesLastWeek: 1, complaintsLastWeek: 1 })
    expect(after.firstSentAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect((w.db.query('SELECT recipient_count FROM app_sends').get() as { recipient_count: number }).recipient_count).toBe(2)

    await w.store.pauseSending(app.id, 'too many bounces', now)
    await w.store.pauseSending(app.id, 'a later reason does not replace the first', now)
    expect((await w.store.sendingCounts(app.id, app.teamId, now)).pausedReason).toBe('too many bounces')
    expect(await sendForApp(app, { to: 'c@example.com', subject: 'Hi', text: 'x' }, w.sendDeps)).toMatchObject({ ok: false, status: 403 })
  })

  test('another workspace cannot take a registered domain', async () => {
    const w = world()
    const mine = await w.connect(1, 'Votescape')
    const theirs = await w.connect(2, 'Other')
    await registerSendingDomain(mine.app, 'votescape.org', w.domainDeps)
    expect(await registerSendingDomain(theirs.app, 'votescape.org', w.domainDeps)).toMatchObject({ ok: false, status: 409 })
  })

  test('a contact is created once, updated without losing what was not sent, and joined to the workspace\'s audience', async () => {
    const w = world()
    const { app } = await w.connect()
    const created = await upsertContactForApp(app, { email: 'Ada@Example.com', firstName: 'Ada', properties: { plan: 'pro' }, audience: 'aud-1' }, { store: w.store })
    expect(created).toMatchObject({ ok: true, status: 201, data: { created: true, audience: true } })
    const updated = await upsertContactForApp(app, { email: 'ada@example.com', lastName: 'Lovelace', properties: { seats: 3 } }, { store: w.store })
    expect(updated).toMatchObject({ ok: true, status: 200, data: { created: false } })

    const row = w.db.query('SELECT email, first_name, last_name, source, properties, team_id FROM contacts').all() as any[]
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({ email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace', source: 'app:Votescape', team_id: 10 })
    expect(JSON.parse(row[0].properties)).toEqual({ plan: 'pro', seats: 3 })
    expect(w.joined).toHaveLength(1)
    expect(w.db.query('SELECT quantity FROM usage_meters WHERE team_id = 10 AND key = \'contacts\'').get()).toEqual({ quantity: 1 })
  })

  test('the package\'s connect codes live in the generated table: a connect is started, approved once and collected once', async () => {
    const { db, store } = database()
    const codes = sqlConnectCodeStore({ unsafe: (sql: string, params: unknown[] = []) => Promise.resolve(db.query(sql).all(...(params as any[]))) }, { dialect: 'sqlite' })
    const service = createHqService(createCommshqAdapter({ store, codes, origin: () => 'https://commshq.test' }))

    const started = await service.startConnect(new Request('http://x/api/cli/connect', { method: 'POST', body: JSON.stringify({ app: 'Votescape' }) }))
    const { code } = await started.json() as { code: string }
    // Only the hash of the code is in the table.
    const stored = db.query('SELECT code_hash, app, status FROM hq_connect_codes').all() as Array<{ code_hash: string, app: string, status: string }>
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ app: 'Votescape', status: 'pending' })
    expect(stored[0]!.code_hash).not.toBe(code)

    expect(await service.approveConnect(code, { id: 1 }, 'WRONG1')).toEqual({ ok: false, reason: 'confirmation_mismatch' })
    expect((await service.approveConnect(code, { id: 1 }, await confirmationCode(code))).ok).toBe(true)

    const collected = await (await service.pollConnect(new Request(`http://x/api/cli/connect/${code}`))).json() as { status: string, ingestKey: string, readKey: string }
    expect(collected.status).toBe('approved')
    expect(await authenticateSendKey(store, collected.ingestKey)).toMatchObject({ name: 'Votescape', teamId: 10 })
    expect((await service.pollConnect(new Request(`http://x/api/cli/connect/${code}`))).status).toBe(404)
    expect(db.query('SELECT count(*) AS n FROM hq_connect_codes').get()).toEqual({ n: 0 })
  })
})

describe('a workspace\'s allowance, month by month', () => {
  const NOVEMBER = new Date('2026-11-16T09:30:00.000Z')
  const SEPTEMBER = { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' }

  /** A fresh function over the same database: the helper remembers a month per function it is handed. */
  const runOn = (db: Database) => async (sql: string, params: unknown[] = []) => db.query(sql).all(...(params as any[])) as Record<string, unknown>[]
  const rows = (db: Database, teamId: number, start: string) =>
    db.query('SELECT key, quantity, included_quantity, period_end FROM usage_meters WHERE team_id = ? AND period_start = ? ORDER BY key').all(teamId, start) as Array<{ key: string, quantity: number, included_quantity: number | null, period_end: string }>

  test('a month is the calendar month in UTC, and a plan\'s limits become allowances', () => {
    expect(monthOf(new Date('2026-11-30T23:59:59.999Z'))).toEqual({ start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' })
    expect(monthOf(new Date('2026-12-01T00:00:00.000Z'))).toEqual({ start: '2026-12-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' })
    expect(meterAllowances({ contacts: 1000, emailsPerMonth: 10000, customDomains: 0, aiGenerations: 0, sms: false }))
      .toEqual({ contacts: 1000, emails: 10000, sms_segments: 0, ai_generations: 0, custom_domains: 0 })
    // A plan with SMS has no included allowance of it: it is billed as used.
    expect(meterAllowances({ contacts: null, emailsPerMonth: 250000, customDomains: 10, aiGenerations: 5000, sms: true }).sms_segments).toBeNull()
  })

  test('a new month carries the allowance forward, keeps what is held, and starts what is spent at nothing', async () => {
    const { db } = database()
    db.run('INSERT INTO teams (id, name) VALUES (30, \'Rolled\')')
    const insert = 'INSERT INTO usage_meters (team_id, key, quantity, included_quantity, period_start, period_end) VALUES (30, ?, ?, ?, ?, ?)'
    db.run(insert, ['emails', 50, 250000, SEPTEMBER.start, SEPTEMBER.end])
    db.run(insert, ['contacts', 7, 25000, SEPTEMBER.start, SEPTEMBER.end])
    db.run(insert, ['custom_domains', 2, 10, SEPTEMBER.start, SEPTEMBER.end])
    db.run(insert, ['ai_generations', 40, 5000, SEPTEMBER.start, SEPTEMBER.end])
    db.run(insert, ['sms_segments', 12, null, SEPTEMBER.start, SEPTEMBER.end])

    await ensureOpenMeters(runOn(db), 30, { now: NOVEMBER })

    expect(rows(db, 30, '2026-11-01T00:00:00.000Z')).toEqual([
      { key: 'ai_generations', quantity: 0, included_quantity: 5000, period_end: '2026-12-01T00:00:00.000Z' },
      { key: 'contacts', quantity: 7, included_quantity: 25000, period_end: '2026-12-01T00:00:00.000Z' },
      { key: 'custom_domains', quantity: 2, included_quantity: 10, period_end: '2026-12-01T00:00:00.000Z' },
      { key: 'emails', quantity: 0, included_quantity: 250000, period_end: '2026-12-01T00:00:00.000Z' },
      { key: 'sms_segments', quantity: 0, included_quantity: null, period_end: '2026-12-01T00:00:00.000Z' },
    ])
    // September is as it was: a closed month is a record, not a counter.
    expect(rows(db, 30, SEPTEMBER.start).find(row => row.key === 'emails')).toMatchObject({ quantity: 50 })
  })

  test('asking again, or twice at once, adds nothing', async () => {
    const { db } = database()
    db.run('INSERT INTO teams (id, name) VALUES (31, \'Twice\')')
    db.run('INSERT INTO usage_meters (team_id, key, quantity, included_quantity, period_start, period_end) VALUES (31, \'emails\', 9, 100, ?, ?)', [SEPTEMBER.start, SEPTEMBER.end])

    await Promise.all([ensureOpenMeters(runOn(db), 31, { now: NOVEMBER }), ensureOpenMeters(runOn(db), 31, { now: NOVEMBER })])
    await ensureOpenMeters(runOn(db), 31, { now: NOVEMBER })
    const run = runOn(db)
    await ensureOpenMeters(run, 31, { now: NOVEMBER })
    await ensureOpenMeters(run, 31, { now: NOVEMBER })

    expect(rows(db, 31, '2026-11-01T00:00:00.000Z').map(row => row.key)).toEqual([...METER_KEYS].sort())
    expect(db.query('SELECT count(*) AS n FROM usage_meters WHERE team_id = 31').get()).toEqual({ n: 6 })
  })

  test('once a month is seen to be whole it is not looked at again', async () => {
    const { db } = database()
    db.run('INSERT INTO teams (id, name) VALUES (32, \'Counted\')')
    let statements = 0
    const run = async (sql: string, params: unknown[] = []) => {
      statements++
      return db.query(sql).all(...(params as any[])) as Record<string, unknown>[]
    }
    await ensureOpenMeters(run, 32, { now: NOVEMBER })
    const first = statements
    await ensureOpenMeters(run, 32, { now: NOVEMBER })
    expect(statements).toBe(first)
    // The next month is looked at, once.
    await ensureOpenMeters(run, 32, { now: new Date('2026-12-01T00:00:00.000Z') })
    expect(statements).toBeGreaterThan(first)
  })

  test('a workspace with no rows at all starts on the free plan in config/saas.ts', async () => {
    const { db } = database()
    db.run('INSERT INTO teams (id, name) VALUES (33, \'New\')')
    await ensureOpenMeters(runOn(db), 33, { now: NOVEMBER })
    const free = await freeMeterAllowances()
    expect(free).toEqual({ contacts: 1000, emails: 10000, sms_segments: 0, ai_generations: 0, custom_domains: 0 })
    expect(Object.fromEntries(rows(db, 33, '2026-11-01T00:00:00.000Z').map(row => [row.key, row.included_quantity]))).toEqual(free)
  })

  test('the first send of a month opens it, against that month and not the last one', async () => {
    const { db, store } = database()
    db.run('INSERT INTO teams (id, name) VALUES (34, \'Spent\')')
    // Last month's allowance was used to the end.
    db.run('INSERT INTO usage_meters (team_id, key, quantity, included_quantity, period_start, period_end) VALUES (34, \'emails\', 5, 5, ?, ?)', [SEPTEMBER.start, SEPTEMBER.end])

    expect(await store.reserve(34, 'emails', 2)).toBe(true)
    const open = monthOf(new Date()).start
    expect(rows(db, 34, open).find(row => row.key === 'emails')).toMatchObject({ quantity: 2, included_quantity: 5 })
    expect(rows(db, 34, SEPTEMBER.start).find(row => row.key === 'emails')).toMatchObject({ quantity: 5 })
    // And it is still an allowance: four more do not fit in five.
    expect(await store.reserve(34, 'emails', 4)).toBe(false)
    expect((await store.meters(34)).find(m => m.meter === 'emails')).toEqual({ meter: 'emails', used: 2, limit: 5 })
  })
})

describe('a workspace for somebody who has none', () => {
  test('is named after the person, else after their address', () => {
    expect(workspaceName('Ada Lovelace', 'ada@example.com')).toBe('Ada Lovelace\'s workspace')
    expect(workspaceName('  ', 'ada.l@example.com')).toBe('ada.l\'s workspace')
    expect(workspaceName(null, null)).toBe('My workspace')
    expect(workspaceName('x'.repeat(300), '').length).toBeLessThanOrEqual(100)
  })

  test('is made on connect, with them as owner and the free plan\'s allowance', async () => {
    const w = world()
    w.db.run('INSERT INTO users (id, name, email) VALUES (7, \'Ada Lovelace\', \'ada@example.com\')')
    const { app } = await w.connect(7, 'Engine')

    const team = w.db.query('SELECT id, name, status, member_count FROM teams WHERE id = ?').get(app.teamId) as { id: number, name: string, status: string, member_count: number }
    expect(team).toMatchObject({ name: 'Ada Lovelace\'s workspace', status: 'active', member_count: 1 })
    expect(w.db.query('SELECT user_id, role, status FROM team_members WHERE team_id = ?').all(app.teamId)).toEqual([{ user_id: 7, role: 'owner', status: 'active' }])
    expect((await w.store.meters(app.teamId)).find(m => m.meter === 'emails')).toEqual({ meter: 'emails', used: 0, limit: 10000 })
    // It can send from its first minute.
    expect((await sendForApp(app, { to: 'a@example.com', subject: 'Hi', text: 'x' }, w.sendDeps)).ok).toBe(true)

    // The same person connecting again is in the workspace they were given.
    const again = await w.connect(7, 'Second engine')
    expect(again.app.teamId).toBe(app.teamId)
    expect(w.db.query('SELECT count(*) AS n FROM teams').get()).toEqual({ n: 3 })
  })

  test('two people of one name get two workspaces, told apart', async () => {
    const w = world()
    w.db.run('INSERT INTO users (id, name, email) VALUES (8, \'Sam\', \'sam@one.example\'), (9, \'Sam\', \'sam@two.example\'), (11, NULL, \'pat@example.com\')')
    const first = await w.connect(8, 'One')
    const second = await w.connect(9, 'Two')
    const third = await w.connect(11, 'Three')
    const name = (teamId: number) => (w.db.query('SELECT name FROM teams WHERE id = ?').get(teamId) as { name: string }).name
    expect(name(first.app.teamId)).toBe('Sam\'s workspace')
    expect(name(second.app.teamId)).toBe('Sam\'s workspace 2')
    expect(name(third.app.teamId)).toBe('pat\'s workspace')
    expect(new Set([first.app.teamId, second.app.teamId, third.app.teamId]).size).toBe(3)
  })
})

describe('an app\'s signup form, in the tables the public form endpoint reads', () => {
  const deps = (w: ReturnType<typeof world>) => ({ store: w.store, origin: () => 'https://commshq.test' })

  test('is one active double opt-in form and one audience, however often it is asked for', async () => {
    const w = world()
    const { app } = await w.connect()
    const first = await signupFormForApp(app, { origin: 'https://votescape.org' }, deps(w))
    if (!first.ok)
      throw new Error(first.error)
    const again = await signupFormForApp(app, { origin: 'https://votescape.org' }, deps(w))
    expect(again).toEqual(first)

    const forms = w.db.query('SELECT uuid, name, slug, kind, status, double_opt_in, team_id, audience_id, schema_document FROM form_definitions').all() as any[]
    expect(forms).toHaveLength(1)
    expect(forms[0]).toMatchObject({ uuid: first.data.id, name: 'Votescape signup', slug: `app-${app.id}`, kind: 'inline', status: 'active', double_opt_in: 1, team_id: 10 })
    expect(JSON.parse(forms[0].schema_document)).toEqual({
      fields: [{ name: 'email', type: 'email', required: true }],
      listName: 'Votescape',
      successUrl: 'https://votescape.org/?subscribed=1',
      allowedOrigins: ['https://votescape.org'],
    })
    const audience = w.db.query('SELECT id, uuid, name, channel, team_id FROM audiences WHERE name = \'Votescape subscribers\'').all() as any[]
    expect(audience).toHaveLength(1)
    expect(audience[0]).toMatchObject({ uuid: first.data.audienceId, channel: 'email', team_id: 10, id: forms[0].audience_id })
    expect(first.data.submitUrl).toBe(`https://commshq.test/forms/${first.data.id}/submit`)
  })

  test('a new origin rewrites the form\'s document and nothing else', async () => {
    const w = world()
    const { app } = await w.connect()
    const first = await signupFormForApp(app, { origin: 'https://votescape.org' }, deps(w))
    const moved = await signupFormForApp(app, { origin: 'https://www.votescape.org', listName: 'Votescape news' }, deps(w))
    expect(moved).toEqual(first)
    const row = w.db.query('SELECT schema_document, status FROM form_definitions').get() as { schema_document: string, status: string }
    expect(JSON.parse(row.schema_document)).toMatchObject({ listName: 'Votescape news', allowedOrigins: ['https://www.votescape.org'], successUrl: 'https://www.votescape.org/?subscribed=1' })
    expect(w.db.query('SELECT count(*) AS n FROM audiences WHERE team_id = 10').get()).toEqual({ n: 2 })

    w.db.run('UPDATE form_definitions SET status = \'archived\'')
    expect(await signupFormForApp(app, { origin: 'https://votescape.org' }, deps(w))).toMatchObject({ ok: false, status: 409 })
  })

  test('uses the audience of that name the workspace already has', async () => {
    const w = world()
    w.db.run('INSERT INTO audiences (id, uuid, team_id, name) VALUES (6, \'aud-own\', 10, \'Votescape subscribers\')')
    const { app } = await w.connect()
    const form = await signupFormForApp(app, { origin: 'https://votescape.org' }, deps(w))
    expect(form).toMatchObject({ ok: true, data: { audienceId: 'aud-own' } })
    expect(w.db.query('SELECT count(*) AS n FROM audiences WHERE name = \'Votescape subscribers\'').get()).toEqual({ n: 1 })
  })
})
