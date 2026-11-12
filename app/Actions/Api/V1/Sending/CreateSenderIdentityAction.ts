import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { isUniqueViolation } from '@stacksjs/orm'
import AuditEvent from '../../../../Models/AuditEvent'
import { activeTeam } from '../../../../Support/activeTeam'
import { canManageSending, domainOfAddress } from '../../../../Support/senderDomains'

async function audit(teamId: number, userId: number, action: string, subjectType: string, subjectId: number, metadata: Record<string, unknown>): Promise<void> {
  await AuditEvent.forceCreate({ team_id: teamId, user_id: userId, action, subjectType, subjectId: String(subjectId), metadata: JSON.stringify(metadata), occurredAt: new Date().toISOString() })
}

const NAME_MAX = 160
const ADDRESS_MAX = 255

/**
 * Add an email sender: a name and an address a message can come from.
 *
 * This takes the place of the generated create for `sender-identities`,
 * which stores every sender as `pending` with nothing that could change it,
 * since `status` is not fillable. Here the status follows the one fact that
 * decides it: the sender is verified when its address is at a domain the
 * team has already verified, and pending until that domain is.
 *
 * Email only. An SMS sender is a number issued by the carrier, and no part
 * of this application can verify one.
 */
export default new Action({
  name: 'Create Sender Identity',
  description: 'Registers an email sender, verified when its domain already is',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageSending(membership?.role)) return response.json({ error: 'Sending setup requires an admin or owner role' }, 403)

    const name = String(request.get('name') || '').trim()
    if (!name || name.length > NAME_MAX) return response.json({ error: `name is required and must be ${NAME_MAX} characters or fewer` }, 422)

    const address = String(request.get('address') || '').trim().toLowerCase()
    const domain = domainOfAddress(address)
    if (!domain || address.length > ADDRESS_MAX) return response.json({ error: 'address must be an email address such as hello@example.com' }, 422)

    const replyTo = String(request.get('replyTo') ?? request.get('reply_to') ?? '').trim().toLowerCase() || null
    if (replyTo && (!domainOfAddress(replyTo) || replyTo.length > ADDRESS_MAX)) return response.json({ error: 'replyTo must be an email address' }, 422)

    const verified = await db.selectFrom('sender_domains' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .where('domain' as any, '=', domain)
      .where('status' as any, '=', 'verified')
      .executeTakeFirst() as { id: number } | undefined

    const status = verified ? 'verified' : 'pending'
    const now = new Date().toISOString()

    try {
      const created = await db.insertInto('sender_identities' as any).values({
        team_id: teamId,
        sender_domain_id: verified ? Number(verified.id) : null,
        uuid: crypto.randomUUID(),
        channel: 'email',
        name,
        address,
        reply_to: replyTo,
        status,
        created_at: now,
        updated_at: now,
      } as any).returning(['id'] as any).executeTakeFirstOrThrow() as { id: number }

      await audit(teamId, Number(user.id), 'sender_identity.created', 'SenderIdentity', Number(created.id), { address, status })

      return response.json({ data: { id: Number(created.id), channel: 'email', name, address, reply_to: replyTo, status, created_at: now, updated_at: now } }, 201)
    }
    catch (error) {
      if (isUniqueViolation(error))
        return response.json({ error: 'This workspace already has a sender at that address' }, 409)
      throw error
    }
  },
})
