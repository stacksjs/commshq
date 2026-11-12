import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { isUniqueViolation } from '@stacksjs/orm'
import AuditEvent from '../../../../Models/AuditEvent'
import { activeTeam } from '../../../../Support/activeTeam'
import { canManageSending, newVerificationToken, normalizeDomain, verificationRecord } from '../../../../Support/senderDomains'

async function audit(teamId: number, userId: number, action: string, subjectType: string, subjectId: number, metadata: Record<string, unknown>): Promise<void> {
  await AuditEvent.forceCreate({ team_id: teamId, user_id: userId, action, subjectType, subjectId: String(subjectId), metadata: JSON.stringify(metadata), occurredAt: new Date().toISOString() })
}

/**
 * Add a sending domain, always as `pending`.
 *
 * The only field read from the request is the domain. Status, the token and
 * the record are decided here, so there is no body that creates a verified
 * domain; that takes `VerifySenderDomainAction` seeing the record in DNS.
 */
export default new Action({
  name: 'Create Sender Domain',
  description: 'Registers a sending domain as pending and issues its DNS verification record',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageSending(membership?.role)) return response.json({ error: 'Sending setup requires an admin or owner role' }, 403)

    const domain = normalizeDomain(request.get('domain'))
    if (!domain) return response.json({ error: 'domain must be a hostname such as mail.example.com' }, 422)

    const record = verificationRecord(domain, newVerificationToken())
    const now = new Date().toISOString()

    try {
      const created = await db.insertInto('sender_domains' as any).values({
        team_id: teamId,
        uuid: crypto.randomUUID(),
        domain,
        status: 'pending',
        selector: 'mail',
        dns_records: JSON.stringify([record]),
        verified_at: null,
        last_checked_at: null,
        created_at: now,
        updated_at: now,
      } as any).returning(['id'] as any).executeTakeFirstOrThrow() as { id: number }

      await audit(teamId, Number(user.id), 'sender_domain.created', 'SenderDomain', Number(created.id), { domain })

      return response.json({ data: { id: Number(created.id), domain, status: 'pending', dns_records: JSON.stringify([record]), verified_at: null, last_checked_at: null, created_at: now } }, 201)
    }
    catch (error) {
      // The unique index is on the domain alone: one workspace per domain.
      if (isUniqueViolation(error))
        return response.json({ error: 'This domain is already registered' }, 409)
      throw error
    }
  },
})
