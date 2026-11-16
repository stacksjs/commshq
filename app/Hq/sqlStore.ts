import type { MeterReading } from '@stacksjs/hq/service'
import type { AppStore, ConnectedApp, SenderDomainRow, SendRecord, SignupFormRow } from './apps'
import { ensureOpenMeters } from '../Support/usagePeriods'
import { seal, unseal } from './sealed'
import { DKIM_SELECTOR } from './sendingDomain'

/**
 * `AppStore` over SQL.
 *
 * It is handed the function that runs a statement, so the same code runs
 * against Postgres in production and against SQLite in its tests
 * (tests/Unit/HqSqlStore.test.ts), where the migration that creates its
 * tables is applied first. Statements are written with `?`: the caller
 * rewrites them for a dialect that numbers its placeholders.
 */

type Row = Record<string, unknown>

export interface SqlStoreOptions {
  /** Run a statement and answer its rows. */
  run: (sql: string, params?: unknown[]) => Promise<Row[]>
  /** The application's key, under which a domain's private key is sealed. */
  appKey: () => string
  /** Join a contact to an audience, both by their row ids. */
  joinAudience: (teamId: number, audienceId: number, contactId: number) => Promise<void>
}

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const now = (): string => new Date().toISOString()
const marks = (count: number): string => Array.from({ length: count }, () => '?').join(', ')

function toApp(row: Row | undefined): ConnectedApp | null {
  if (!row)
    return null
  return { id: String(row.uuid), teamId: Number(row.team_id), name: String(row.name), senderDomainId: row.sender_domain_id == null ? null : Number(row.sender_domain_id), fromAddress: row.from_address ? String(row.from_address) : null }
}

const DOMAIN_COLUMNS = 'd.id, d.team_id, d.domain, d.status, d.dns_records, k.dkim_verified_at'
const DOMAIN_FROM = 'sender_domains d LEFT JOIN sender_domain_keys k ON k.sender_domain_id = d.id'

function toDomain(row: Row | undefined): SenderDomainRow | null {
  if (!row)
    return null
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    domain: String(row.domain),
    status: String(row.status) as SenderDomainRow['status'],
    dnsRecords: row.dns_records,
    dkimVerifiedAt: text(row.dkim_verified_at),
  }
}

/** What a new workspace is called: after the person, else the name in their address. */
export function workspaceName(name: unknown, email: unknown): string {
  // eslint-disable-next-line no-control-regex
  const clean = (value: unknown): string => String(value ?? '').replace(/[\u0000-\u001F\u007F<>]/g, '').trim()
  const person = clean(name) || clean(String(email ?? '').split('@')[0])
  // teams.name holds a hundred characters, and a number may be added to tell two apart.
  return person ? `${person.slice(0, 80)}'s workspace` : 'My workspace'
}

function toDocument(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

export function createSqlAppStore(options: SqlStoreOptions): AppStore {
  const query = options.run

  async function appRowId(appId: string): Promise<number | null> {
    const row = (await query('SELECT id FROM connected_apps WHERE uuid = ? LIMIT 1', [appId]))[0]
    return row ? Number(row.id) : null
  }

  /** The open period's meter row for a team. */
  const OPEN_METER = 'team_id = ? AND key = ? AND period_start <= ? AND period_end > ?'

  const store: AppStore = {
    async teamOf(userId) {
      // The earliest active membership: stable across requests, as activeTeam() has it.
      const row = (await query('SELECT team_id, role FROM team_members WHERE user_id = ? AND status = ? ORDER BY id ASC LIMIT 1', [userId, 'active']))[0]
      return row ? { teamId: Number(row.team_id), role: String(row.role) } : null
    },

    async createWorkspace(userId) {
      const user = (await query('SELECT name, email FROM users WHERE id = ? LIMIT 1', [userId]))[0]
      const base = workspaceName(user?.name, user?.email)
      const at = now()

      // A workspace's name is unique, and two people can share one. The second
      // "Chris's workspace" is told apart by a number, and the insert that
      // loses a race for a name simply tries the next.
      let teamId: number | null = null
      for (let attempt = 1; teamId === null && attempt <= 50; attempt++) {
        const created = (await query(
          'INSERT INTO teams (uuid, name, description, status, member_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING RETURNING id',
          [crypto.randomUUID(), attempt === 1 ? base : `${base} ${attempt}`, 'Made when its owner connected their first app.', 'active', 1, at, at],
        ))[0]
        if (created)
          teamId = Number(created.id)
      }
      if (teamId === null)
        throw new Error('A workspace could not be named')

      await query(
        'INSERT INTO team_members (uuid, team_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), teamId, userId, 'owner', 'active', at, at],
      )
      // The free plan's allowance, from this month.
      await ensureOpenMeters(query, teamId)
      // Read back, so two approvals at once agree on which workspace is theirs.
      return (await this.teamOf(userId)) ?? { teamId, role: 'owner' }
    },

    async findApp(teamId, name) {
      return toApp((await query('SELECT uuid, team_id, name, sender_domain_id, from_address FROM connected_apps WHERE team_id = ? AND name_key = ? LIMIT 1', [teamId, name.toLowerCase()]))[0])
    },

    async createApp(teamId, name, userId) {
      const uuid = crypto.randomUUID()
      const at = now()
      await query(
        'INSERT INTO connected_apps (uuid, team_id, name, name_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uuid, teamId, name, name.toLowerCase(), userId, at, at],
      )
      return { id: uuid, teamId, name, senderDomainId: null }
    },

    async addKey(appId, kind, keyHash, hint, userId) {
      const app = (await query('SELECT id, team_id FROM connected_apps WHERE uuid = ? LIMIT 1', [appId]))[0]
      if (!app)
        throw new Error('The app a key was issued for does not exist')
      await query(
        'INSERT INTO app_keys (uuid, connected_app_id, team_id, kind, key_hash, hint, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), app.id, app.team_id, kind, keyHash, hint, userId, now()],
      )
    },

    async findAppByKey(kind, keyHash) {
      return toApp((await query(
        'SELECT a.uuid, a.team_id, a.name, a.sender_domain_id, a.from_address FROM app_keys k JOIN connected_apps a ON a.id = k.connected_app_id WHERE k.key_hash = ? AND k.kind = ? AND k.revoked_at IS NULL LIMIT 1',
        [keyHash, kind],
      ))[0])
    },

    async touchKey(keyHash) {
      // At most once a minute for a key: bookkeeping must not cost a write per request.
      await query('UPDATE app_keys SET last_used_at = ? WHERE key_hash = ? AND (last_used_at IS NULL OR last_used_at < ?)', [now(), keyHash, new Date(Date.now() - 60_000).toISOString()])
    },

    async findDomain(domain) {
      return toDomain((await query(`SELECT ${DOMAIN_COLUMNS} FROM ${DOMAIN_FROM} WHERE d.domain = ? LIMIT 1`, [domain]))[0])
    },

    async findDomainById(id) {
      return toDomain((await query(`SELECT ${DOMAIN_COLUMNS} FROM ${DOMAIN_FROM} WHERE d.id = ? LIMIT 1`, [id]))[0])
    },

    async createDomain(input) {
      const at = now()
      const created = (await query(
        'INSERT INTO sender_domains (team_id, uuid, domain, status, selector, dns_records, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        [input.teamId, crypto.randomUUID(), input.domain, 'pending', DKIM_SELECTOR, JSON.stringify(input.dnsRecords), at, at],
      ))[0]
      const id = Number(created?.id)
      await query(
        'INSERT INTO sender_domain_keys (uuid, sender_domain_id, team_id, selector, public_key, private_key_sealed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), id, input.teamId, DKIM_SELECTOR, input.publicKey, seal(input.privateKey, options.appKey()), at, at],
      )
      return (await this.findDomainById(id))!
    },

    async attachDomainKey(domainId, input) {
      const at = now()
      await query('UPDATE sender_domains SET dns_records = ?, updated_at = ? WHERE id = ?', [JSON.stringify(input.dnsRecords), at, domainId])
      const owner = (await query('SELECT team_id FROM sender_domains WHERE id = ? LIMIT 1', [domainId]))[0]
      await query(
        'INSERT INTO sender_domain_keys (uuid, sender_domain_id, team_id, selector, public_key, private_key_sealed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), domainId, owner?.team_id ?? null, DKIM_SELECTOR, input.publicKey, seal(input.privateKey, options.appKey()), at, at],
      )
      return (await this.findDomainById(domainId))!
    },

    async findAppById(teamId, appId) {
      return toApp((await query('SELECT uuid, team_id, name, sender_domain_id, from_address FROM connected_apps WHERE team_id = ? AND uuid = ? LIMIT 1', [teamId, appId]))[0])
    },

    async rememberFrom(appId, address) {
      await query('UPDATE connected_apps SET from_address = ?, updated_at = ? WHERE uuid = ?', [address.slice(0, 254), now(), appId])
    },

    async setAppDomain(appId, domainId) {
      await query('UPDATE connected_apps SET sender_domain_id = ?, updated_at = ? WHERE uuid = ?', [domainId, now(), appId])
    },

    async markDomainChecked(domainId, checks, at) {
      // Ownership is what the dashboard calls verified, and it is never taken
      // back by a later miss: DNS answers come and go, and a campaign must not
      // fail on one. The key's presence is tracked beside it, and that is
      // what an app's From line waits for.
      if (checks.ownership)
        await query('UPDATE sender_domains SET status = ?, verified_at = COALESCE(verified_at, ?), last_checked_at = ?, updated_at = ? WHERE id = ? AND status <> ?', ['verified', at, at, at, domainId, 'disabled'])
      else
        await query('UPDATE sender_domains SET last_checked_at = ?, updated_at = ? WHERE id = ?', [at, at, domainId])
      await query('UPDATE sender_domain_keys SET dkim_verified_at = ?, updated_at = ? WHERE sender_domain_id = ?', [checks.dkim ? at : null, at, domainId])
      return (await this.findDomainById(domainId))!
    },

    async domainPrivateKey(domainId) {
      const row = (await query('SELECT private_key_sealed FROM sender_domain_keys WHERE sender_domain_id = ? LIMIT 1', [domainId]))[0]
      return row ? unseal(String(row.private_key_sealed), options.appKey()) : null
    },

    async meters(teamId) {
      await ensureOpenMeters(query, teamId)
      const at = now()
      const rows = await query('SELECT key, quantity, included_quantity FROM usage_meters WHERE team_id = ? AND period_start <= ? AND period_end > ? ORDER BY key ASC', [teamId, at, at])
      const meters: MeterReading[] = rows.map(row => ({
        meter: String(row.key),
        used: Number(row.quantity || 0),
        limit: row.included_quantity === null || row.included_quantity === undefined ? null : Number(row.included_quantity),
      }))
      // A workspace with no open period still answers the meter an app sends on.
      return meters.length > 0 ? meters : [{ meter: 'emails', used: 0, limit: 0 }]
    },

    async reserve(teamId, meter, quantity) {
      // A month nobody has sent in yet is opened by the first send in it.
      await ensureOpenMeters(query, teamId)
      const at = now()
      const rows = await query(
        `UPDATE usage_meters SET quantity = quantity + ?, updated_at = ? WHERE ${OPEN_METER} AND (included_quantity IS NULL OR quantity + ? <= included_quantity) RETURNING id`,
        [quantity, at, teamId, meter, at, at, quantity],
      )
      return rows.length > 0
    },

    async release(teamId, meter, quantity) {
      const at = now()
      await query(`UPDATE usage_meters SET quantity = CASE WHEN quantity >= ? THEN quantity - ? ELSE 0 END, updated_at = ? WHERE ${OPEN_METER}`, [quantity, quantity, at, teamId, meter, at, at])
    },

    async suppressed(teamId, recipients) {
      if (recipients.length === 0)
        return []
      const rows = await query(
        `SELECT recipient FROM communication_suppressions WHERE team_id = ? AND channel = ? AND lifted_at IS NULL AND recipient IN (${marks(recipients.length)})`,
        [teamId, 'email', ...recipients],
      )
      return rows.map(row => String(row.recipient).toLowerCase())
    },

    async findSend(appId, idempotencyKey) {
      const row = (await query(
        'SELECT s.uuid, s.from_address, s.authenticated, s.status, s.recipients, s.suppressed FROM app_sends s JOIN connected_apps a ON a.id = s.connected_app_id WHERE a.uuid = ? AND s.idempotency_key = ? LIMIT 1',
        [appId, idempotencyKey],
      ))[0]
      if (!row)
        return null
      const list = (value: unknown): string[] => {
        try {
          const parsed = typeof value === 'string' ? JSON.parse(value) : value
          return Array.isArray(parsed) ? parsed.map(String) : []
        }
        catch {
          return []
        }
      }
      return {
        id: String(row.uuid),
        from: String(row.from_address),
        authenticated: row.authenticated === 'domain' ? 'domain' : 'fallback',
        status: row.status === 'sent' ? 'sent' : 'failed',
        accepted: list(row.recipients),
        suppressed: list(row.suppressed),
      } satisfies SendRecord
    },

    async sendingCounts(appId, teamId, at) {
      const day = new Date(at.getTime() - 86_400_000).toISOString()
      const week = new Date(at.getTime() - 7 * 86_400_000).toISOString()
      const app = (await query('SELECT sending_paused_reason FROM connected_apps WHERE uuid = ? LIMIT 1', [appId]))[0]
      // A row from before recipient_count was kept counts as its one message.
      const sent = (await query(
        `SELECT COALESCE(SUM(CASE WHEN created_at >= ? THEN COALESCE(recipient_count, 1) ELSE 0 END), 0) AS last_day,
                COALESCE(SUM(CASE WHEN created_at >= ? THEN COALESCE(recipient_count, 1) ELSE 0 END), 0) AS last_week,
                MIN(created_at) AS first_sent
           FROM app_sends WHERE team_id = ? AND status = ?`,
        [day, week, teamId, 'sent'],
      ))[0] ?? {}
      const bad = (await query(
        `SELECT COALESCE(SUM(CASE WHEN reason = ? THEN 1 ELSE 0 END), 0) AS bounces,
                COALESCE(SUM(CASE WHEN reason = ? THEN 1 ELSE 0 END), 0) AS complaints
           FROM communication_suppressions WHERE team_id = ? AND channel = ? AND suppressed_at >= ?`,
        ['bounce', 'complaint', teamId, 'email', week],
      ))[0] ?? {}
      const first = sent.first_sent
      return {
        pausedReason: app?.sending_paused_reason ? String(app.sending_paused_reason) : null,
        sentLastDay: Number(sent.last_day ?? 0),
        sentLastWeek: Number(sent.last_week ?? 0),
        bouncesLastWeek: Number(bad.bounces ?? 0),
        complaintsLastWeek: Number(bad.complaints ?? 0),
        firstSentAt: first ? new Date(first as string | Date).toISOString() : null,
      }
    },

    async pauseSending(appId, reason, at) {
      const stamp = at.toISOString()
      await query('UPDATE connected_apps SET sending_paused_at = ?, sending_paused_reason = ?, updated_at = ? WHERE uuid = ? AND sending_paused_at IS NULL', [stamp, reason.slice(0, 500), stamp, appId])
    },

    async recordSend(appId, teamId, record) {
      const id = await appRowId(appId)
      if (id === null)
        return
      const at = now()
      const values = [record.id, record.from, record.authenticated, record.status, JSON.stringify(record.recipients), JSON.stringify(record.suppressed), record.subject.slice(0, 255), record.recipients.length, at]
      // A key that failed before is the same row, sent this time.
      if (record.idempotencyKey) {
        const updated = await query(
          'UPDATE app_sends SET uuid = ?, from_address = ?, authenticated = ?, status = ?, recipients = ?, suppressed = ?, subject = ?, recipient_count = ?, updated_at = ? WHERE connected_app_id = ? AND idempotency_key = ? RETURNING id',
          [...values, id, record.idempotencyKey],
        )
        if (updated.length > 0)
          return
      }
      await query(
        'INSERT INTO app_sends (uuid, from_address, authenticated, status, recipients, suppressed, subject, recipient_count, updated_at, connected_app_id, team_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [...values, id, teamId, record.idempotencyKey, at],
      )
    },

    async upsertContact(teamId, input) {
      const at = now()
      const existing = (await query('SELECT id, uuid, properties FROM contacts WHERE team_id = ? AND email = ? LIMIT 1', [teamId, input.email]))[0]
      if (existing) {
        let stored: Record<string, unknown> = {}
        try {
          stored = (typeof existing.properties === 'string' ? JSON.parse(existing.properties) : existing.properties) ?? {}
        }
        catch { /* a column that does not parse is replaced by what was sent */ }
        const properties = input.properties ? JSON.stringify({ ...stored, ...input.properties }) : null
        // Only what was sent is changed: a name left out is a name kept.
        await query(
          'UPDATE contacts SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), properties = COALESCE(?, properties), updated_at = ? WHERE id = ?',
          [input.firstName ?? null, input.lastName ?? null, properties, at, existing.id],
        )
        let uuid = text(existing.uuid)
        if (!uuid) {
          uuid = crypto.randomUUID()
          await query('UPDATE contacts SET uuid = ? WHERE id = ?', [uuid, existing.id])
        }
        return { id: uuid, created: false }
      }

      const uuid = crypto.randomUUID()
      await query(
        'INSERT INTO contacts (uuid, team_id, email, first_name, last_name, status, source, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid, teamId, input.email, input.firstName ?? null, input.lastName ?? null, 'active', input.source, input.properties ? JSON.stringify(input.properties) : null, at, at],
      )
      return { id: uuid, created: true }
    },

    async joinAudience(teamId, audience, contactId) {
      const list = (await query('SELECT id FROM audiences WHERE team_id = ? AND uuid = ? LIMIT 1', [teamId, audience]))[0]
      const contact = (await query('SELECT id FROM contacts WHERE team_id = ? AND uuid = ? LIMIT 1', [teamId, contactId]))[0]
      if (!list || !contact)
        return false
      await options.joinAudience(teamId, Number(list.id), Number(contact.id))
      return true
    },

    async findSignupForm(teamId, slug) {
      const row = (await query(
        'SELECT f.id, f.uuid, f.status, f.schema_document, f.audience_id, a.uuid AS audience_uuid FROM form_definitions f LEFT JOIN audiences a ON a.id = f.audience_id WHERE f.team_id = ? AND f.slug = ? LIMIT 1',
        [teamId, slug],
      ))[0]
      if (!row)
        return null

      // Rows made before public ids were kept have none. They are given one,
      // since the id is the only way a page can address the form.
      let id = text(row.uuid)
      if (!id) {
        id = crypto.randomUUID()
        await query('UPDATE form_definitions SET uuid = ? WHERE id = ?', [id, row.id])
      }
      let audienceId = text(row.audience_uuid)
      if (!audienceId && row.audience_id != null) {
        audienceId = crypto.randomUUID()
        await query('UPDATE audiences SET uuid = ? WHERE id = ?', [audienceId, row.audience_id])
      }
      return { id, status: String(row.status) as SignupFormRow['status'], document: toDocument(row.schema_document), audienceId }
    },

    async createSignupForm(input) {
      const at = now()
      // The audience of that name is the app's, whether this made it or an
      // earlier call did: a team's audience names are unique.
      await query(
        'INSERT INTO audiences (uuid, team_id, name, description, channel, member_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (team_id, name) DO NOTHING',
        [crypto.randomUUID(), input.teamId, input.audienceName, 'People who signed up through the app\'s own form.', 'email', 0, at, at],
      )
      const audience = (await query('SELECT id FROM audiences WHERE team_id = ? AND name = ? LIMIT 1', [input.teamId, input.audienceName]))[0]

      // `double_opt_in` is left to its default, which is on. A second caller
      // loses to the unique slug and reads the first one's form back.
      await query(
        'INSERT INTO form_definitions (uuid, team_id, name, slug, kind, schema_document, status, audience_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (team_id, slug) DO NOTHING',
        [crypto.randomUUID(), input.teamId, input.name, input.slug, 'inline', JSON.stringify(input.document), 'active', audience?.id ?? null, at, at],
      )
      return (await this.findSignupForm(input.teamId, input.slug))!
    },

    async setSignupFormDocument(teamId, slug, document) {
      await query('UPDATE form_definitions SET schema_document = ?, updated_at = ? WHERE team_id = ? AND slug = ?', [JSON.stringify(document), now(), teamId, slug])
    },
  }

  return store
}
