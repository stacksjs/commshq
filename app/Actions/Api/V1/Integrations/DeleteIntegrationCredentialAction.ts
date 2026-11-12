import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../../Models/AuditEvent'
import { activeTeam } from '../../../../Support/activeTeam'
import { canManageIntegrations } from '../../../../Support/integrationConnectors'

/**
 * Remove a stored credential.
 *
 * In place of the generated delete, which any member could call: removing a
 * credential stops every profile that depends on it, which is an admin's
 * decision. The profiles are left as they are; their next sync finds no
 * credential and parks them as unconfigured, which is the truth.
 */
export default new Action({
  name: 'Delete Integration Credential',
  description: 'Removes a stored service credential',
  method: 'DELETE',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageIntegrations(membership?.role)) return response.json({ error: 'Connecting a service requires an admin or owner role' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'Credential id must be a positive integer' }, 422)

    const row = await db.selectFrom('integration_credentials' as any)
      .select(['id', 'provider'] as any)
      .where('id' as any, '=', id)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst() as { id: number, provider: string } | undefined
    if (!row) return response.json({ error: 'Credential not found' }, 404)

    await db.deleteFrom('integration_credentials' as any).where('id' as any, '=', id).where('team_id' as any, '=', teamId).execute()

    await AuditEvent.forceCreate({
      team_id: teamId,
      user_id: Number(user.id),
      action: 'integration_credential.deleted',
      subjectType: 'IntegrationCredential',
      subjectId: String(id),
      metadata: JSON.stringify({ provider: row.provider }),
      occurredAt: new Date().toISOString(),
    })

    return response.json({ data: { id, deleted: true } })
  },
})
