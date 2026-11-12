import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../../Models/AuditEvent'
import { activeTeam } from '../../../../Support/activeTeam'
import { canManageSending } from '../../../../Support/senderDomains'

async function audit(teamId: number, userId: number, action: string, subjectType: string, subjectId: number, metadata: Record<string, unknown>): Promise<void> {
  await AuditEvent.forceCreate({ team_id: teamId, user_id: userId, action, subjectType, subjectId: String(subjectId), metadata: JSON.stringify(metadata), occurredAt: new Date().toISOString() })
}

/**
 * Remove a sending domain.
 *
 * Its senders stay, but go back to `pending` and lose the link: an address
 * is verified only through its domain, and that proof has just been removed.
 */
export default new Action({
  name: 'Delete Sender Domain',
  description: 'Removes a sending domain and returns its senders to pending',
  method: 'DELETE',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageSending(membership?.role)) return response.json({ error: 'Sending setup requires an admin or owner role' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'Domain id must be a positive integer' }, 422)

    const row = await db.selectFrom('sender_domains' as any)
      .select(['id', 'domain'] as any)
      .where('id' as any, '=', id)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst() as { id: number, domain: string } | undefined
    if (!row) return response.json({ error: 'Domain not found' }, 404)

    const now = new Date().toISOString()
    await db.updateTable('sender_identities' as any).set({ status: 'pending', sender_domain_id: null, updated_at: now } as any)
      .where('team_id' as any, '=', teamId)
      .where('sender_domain_id' as any, '=', id)
      .execute()
    await db.deleteFrom('sender_domains' as any).where('id' as any, '=', id).where('team_id' as any, '=', teamId).execute()

    await audit(teamId, Number(user.id), 'sender_domain.deleted', 'SenderDomain', id, { domain: row.domain })

    return response.json({ data: { id, deleted: true } })
  },
})
