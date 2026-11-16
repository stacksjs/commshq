import type { AppStore, ConnectedApp, SenderDomainRow, SendRecord } from '../../app/Hq/apps'

/**
 * An `AppStore` held in memory, for the tests of app/Hq. It keeps what the
 * SQL store keeps and nothing more, so a test that passes here is a
 * statement about the logic and not about a database.
 */
export function memoryAppStore(options: {
  teams?: Record<number, { teamId: number, role: string }>
  meters?: Record<number, { emails?: { used: number, limit: number | null }, contacts?: { used: number, limit: number | null } }>
  suppressed?: Record<number, string[]>
  audiences?: Record<number, string[]>
} = {}) {
  const teams = options.teams ?? { 1: { teamId: 10, role: 'owner' } }
  const meters = options.meters ?? { 10: { emails: { used: 0, limit: 100 }, contacts: { used: 0, limit: 1000 } } }
  const apps: ConnectedApp[] = []
  const keys: Array<{ appId: string, kind: 'send' | 'read', hash: string, revoked: boolean, touched: number }> = []
  const domains: Array<SenderDomainRow & { privateKey: string | null }> = []
  const sends: Array<SendRecord & { appId: string, idempotencyKey: string | null }> = []
  const contacts: Array<{ id: string, teamId: number, email: string, input: any }> = []
  const memberships: string[] = []

  const store: AppStore = {
    async teamOf(userId) {
      return teams[userId] ?? null
    },
    async findApp(teamId, name) {
      return apps.find(app => app.teamId === teamId && app.name.toLowerCase() === name.toLowerCase()) ?? null
    },
    async createApp(teamId, name) {
      const app: ConnectedApp = { id: `app-${apps.length + 1}`, teamId, name, senderDomainId: null }
      apps.push(app)
      return { ...app }
    },
    async addKey(appId, kind, hash) {
      keys.push({ appId, kind, hash, revoked: false, touched: 0 })
    },
    async findAppByKey(kind, hash) {
      const key = keys.find(k => k.kind === kind && k.hash === hash && !k.revoked)
      const app = key ? apps.find(a => a.id === key.appId) : undefined
      return app ? { ...app } : null
    },
    async touchKey(hash) {
      const key = keys.find(k => k.hash === hash)
      if (key)
        key.touched++
    },
    async findDomain(domain) {
      const row = domains.find(d => d.domain === domain)
      return row ? { ...row } : null
    },
    async findDomainById(id) {
      const row = domains.find(d => d.id === id)
      return row ? { ...row } : null
    },
    async createDomain(input) {
      const row = { id: domains.length + 1, teamId: input.teamId, domain: input.domain, status: 'pending' as const, dnsRecords: input.dnsRecords, dkimVerifiedAt: null, privateKey: input.privateKey }
      domains.push(row)
      return { ...row }
    },
    async attachDomainKey(domainId, input) {
      const row = domains.find(d => d.id === domainId)!
      row.dnsRecords = input.dnsRecords
      row.privateKey = input.privateKey
      row.dkimVerifiedAt = null
      return { ...row }
    },
    async setAppDomain(appId, domainId) {
      apps.find(a => a.id === appId)!.senderDomainId = domainId
    },
    async markDomainChecked(domainId, checks, now) {
      const row = domains.find(d => d.id === domainId)!
      if (checks.ownership)
        row.status = 'verified'
      row.dkimVerifiedAt = checks.dkim ? now : null
      return { ...row }
    },
    async domainPrivateKey(domainId) {
      return domains.find(d => d.id === domainId)?.privateKey ?? null
    },
    async meters(teamId) {
      const m = meters[teamId] ?? {}
      return Object.entries(m).map(([meter, value]) => ({ meter, used: value!.used, limit: value!.limit }))
    },
    async reserve(teamId, meter, quantity) {
      const m = meters[teamId]?.[meter]
      if (!m)
        return false
      if (m.limit !== null && m.used + quantity > m.limit)
        return false
      m.used += quantity
      return true
    },
    async release(teamId, meter, quantity) {
      const m = meters[teamId]?.[meter]
      if (m)
        m.used = Math.max(0, m.used - quantity)
    },
    async suppressed(teamId, recipients) {
      const list = options.suppressed?.[teamId] ?? []
      return recipients.filter(address => list.includes(address))
    },
    async findSend(appId, idempotencyKey) {
      const found = sends.find(s => s.appId === appId && s.idempotencyKey === idempotencyKey)
      return found ? { id: found.id, from: found.from, authenticated: found.authenticated, status: found.status, accepted: found.accepted, suppressed: found.suppressed } : null
    },
    async recordSend(appId, _teamId, record) {
      const existing = sends.findIndex(s => s.appId === appId && record.idempotencyKey !== null && s.idempotencyKey === record.idempotencyKey)
      const row = { appId, idempotencyKey: record.idempotencyKey, id: record.id, from: record.from, authenticated: record.authenticated, status: record.status, accepted: record.accepted, suppressed: record.suppressed }
      if (existing >= 0)
        sends[existing] = row
      else
        sends.push(row)
    },
    async upsertContact(teamId, input) {
      const existing = contacts.find(c => c.teamId === teamId && c.email === input.email)
      if (existing) {
        existing.input = { ...existing.input, ...input }
        return { id: existing.id, created: false }
      }
      const contact = { id: `contact-${contacts.length + 1}`, teamId, email: input.email, input }
      contacts.push(contact)
      return { id: contact.id, created: true }
    },
    async joinAudience(teamId, audience, contactId) {
      if (!(options.audiences?.[teamId] ?? []).includes(audience))
        return false
      memberships.push(`${audience}:${contactId}`)
      return true
    },
  }

  return {
    store,
    apps,
    keys,
    domains,
    sends,
    contacts,
    memberships,
    meters,
    /** Stop a key working, as the dashboard's revoke does. */
    revoke(hash: string): void {
      const key = keys.find(k => k.hash === hash)
      if (key)
        key.revoked = true
    },
  }
}
