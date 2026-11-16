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
import { authenticateSendKey, createCommshqAdapter, registerSendingDomain, sendForApp, upsertContactForApp, verifySendingDomain } from '../../app/Hq/apps'
import { hashAppKey } from '../../app/Hq/keys'
import { createSqlAppStore } from '../../app/Hq/sqlStore'
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
  for (const table of ['teams', 'team_members', 'usage_meters', 'contacts', 'communication_suppressions', 'audiences', 'sender_domains']) {
    for (const statement of statements(migration(table)))
      db.run(statement)
  }
  // And the five this feature adds, generated from their models.
  for (const table of ['connected_apps', 'app_keys', 'app_sends', 'sender_domain_keys', 'hq_connect_codes']) {
    for (const statement of statements(migration(table)))
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
    expect(await w.adapter.usage!(principal!)).toEqual([{ meter: 'contacts', used: 0, limit: null }, { meter: 'emails', used: 0, limit: 3 }])

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
