import type { MeterReading } from '@stacksjs/hq/service'
import type { AppStore, ConnectedApp, SenderDomainRow, SendRecord } from './apps'
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
  return { id: String(row.uuid), teamId: Number(row.team_id), name: String(row.name), senderDomainId: row.sender_domain_id == null ? null : Number(row.sender_domain_id) }
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

    async findApp(teamId, name) {
      return toApp((await query('SELECT uuid, team_id, name, sender_domain_id FROM connected_apps WHERE team_id = ? AND name_key = ? LIMIT 1', [teamId, name.toLowerCase()]))[0])
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
        'SELECT a.uuid, a.team_id, a.name, a.sender_domain_id FROM app_keys k JOIN connected_apps a ON a.id = k.connected_app_id WHERE k.key_hash = ? AND k.kind = ? AND k.revoked_at IS NULL LIMIT 1',
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

    async recordSend(appId, teamId, record) {
      const id = await appRowId(appId)
      if (id === null)
        return
      const at = now()
      const values = [record.id, record.from, record.authenticated, record.status, JSON.stringify(record.recipients), JSON.stringify(record.suppressed), record.subject.slice(0, 255), at]
      // A key that failed before is the same row, sent this time.
      if (record.idempotencyKey) {
        const updated = await query(
          'UPDATE app_sends SET uuid = ?, from_address = ?, authenticated = ?, status = ?, recipients = ?, suppressed = ?, subject = ?, updated_at = ? WHERE connected_app_id = ? AND idempotency_key = ? RETURNING id',
          [...values, id, record.idempotencyKey],
        )
        if (updated.length > 0)
          return
      }
      await query(
        'INSERT INTO app_sends (uuid, from_address, authenticated, status, recipients, suppressed, subject, updated_at, connected_app_id, team_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
  }

  return store
}
