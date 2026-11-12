import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { resolveTxt } from 'node:dns/promises'
import AuditEvent from '../../../../Models/AuditEvent'
import { activeTeam } from '../../../../Support/activeTeam'
import { canManageSending, storedVerification, txtAnswerMatches } from '../../../../Support/senderDomains'

async function audit(teamId: number, userId: number, action: string, subjectType: string, subjectId: number, metadata: Record<string, unknown>): Promise<void> {
  await AuditEvent.forceCreate({ team_id: teamId, user_id: userId, action, subjectType, subjectId: String(subjectId), metadata: JSON.stringify(metadata), occurredAt: new Date().toISOString() })
}

/** A lookup that finds no record is an answer, not a failure. */
async function lookupTxt(host: string): Promise<{ answer: string[][], failed: boolean }> {
  try {
    return { answer: await resolveTxt(host), failed: false }
  }
  catch (error) {
    const code = String((error as { code?: unknown })?.code || '')
    return { answer: [], failed: !['ENOTFOUND', 'ENODATA'].includes(code) }
  }
}

/**
 * Look the domain's verification record up in DNS, and mark it verified if
 * it is there.
 *
 * The expected value is read from the row, never from the request, so the
 * only way to pass is to publish the record this application issued. When a
 * domain passes, the team's email senders at that domain become verified
 * with it: an address is provable exactly when its domain is.
 *
 * A miss leaves the domain pending and records when it was looked for. DNS
 * changes take time to spread, so a miss is the normal first answer.
 */
export default new Action({
  name: 'Verify Sender Domain',
  description: 'Checks DNS for a sending domain verification record and marks the domain verified when present',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageSending(membership?.role)) return response.json({ error: 'Sending setup requires an admin or owner role' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'Domain id must be a positive integer' }, 422)

    const row = await db.selectFrom('sender_domains' as any)
      .select(['id', 'domain', 'status', 'dns_records'] as any)
      .where('id' as any, '=', id)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst() as { id: number, domain: string, status: string, dns_records: unknown } | undefined
    if (!row) return response.json({ error: 'Domain not found' }, 404)
    if (row.status === 'verified') return response.json({ data: { id, status: 'verified', verified: true } })
    if (row.status === 'disabled') return response.json({ error: 'This domain is disabled' }, 409)

    const record = storedVerification(row.dns_records)
    if (!record) return response.json({ error: 'This domain has no verification record. Remove it and add it again.' }, 409)

    const { answer, failed } = await lookupTxt(record.host)
    const now = new Date().toISOString()
    if (failed) return response.json({ error: 'DNS could not be reached to check this domain. Try again shortly.' }, 503)

    if (!txtAnswerMatches(answer, record.value)) {
      await db.updateTable('sender_domains' as any).set({ last_checked_at: now, updated_at: now } as any)
        .where('id' as any, '=', id).where('team_id' as any, '=', teamId).execute()
      return response.json({ data: { id, status: 'pending', verified: false, last_checked_at: now } })
    }

    await db.updateTable('sender_domains' as any).set({ status: 'verified', verified_at: now, last_checked_at: now, updated_at: now } as any)
      .where('id' as any, '=', id).where('team_id' as any, '=', teamId).execute()

    await db.updateTable('sender_identities' as any).set({ status: 'verified', sender_domain_id: id, updated_at: now } as any)
      .where('team_id' as any, '=', teamId)
      .where('channel' as any, '=', 'email')
      .where('status' as any, '=', 'pending')
      .where('address' as any, 'like', `%@${row.domain}`)
      .execute()

    await audit(teamId, Number(user.id), 'sender_domain.verified', 'SenderDomain', id, { domain: row.domain })

    return response.json({ data: { id, status: 'verified', verified: true, verified_at: now, last_checked_at: now } })
  },
})
