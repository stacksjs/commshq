import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../../Models/AuditEvent'
import { activeTeam } from '../../../../Support/activeTeam'
import IntegrationCredential from '../../../../Models/IntegrationCredential'
import { canManageIntegrations, CONNECTION_NAME, connectorFor, lastFourOf, normalizeCredential } from '../../../../Support/integrationConnectors'

/**
 * Store, or replace, the credential a workspace uses for one service.
 *
 * `IntegrationCredential` publishes no generated create, rightly: its value
 * is guarded and encrypted. That left no way at all to store one, so a
 * monitored profile could be added and would sit `unconfigured` for good.
 *
 * The secret goes in through `forceCreate`, the write the model encrypts,
 * and it never comes back: the answer carries the provider, the last four
 * characters and the dates. A workspace holds one credential per service,
 * since `credentialFor` reads the first it finds, so storing again replaces
 * the old one instead of adding a second that might or might not be used.
 *
 * Profiles of that service parked as `unconfigured` are put back in the
 * polling queue, which is the reason anyone stores a credential.
 */
export default new Action({
  name: 'Store Integration Credential',
  description: 'Encrypts and stores the credential a workspace uses for one service',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageIntegrations(membership?.role)) return response.json({ error: 'Connecting a service requires an admin or owner role' }, 403)

    const connector = connectorFor(request.get('provider'))
    if (!connector) return response.json({ error: 'No connector is available for that service' }, 422)

    const secret = normalizeCredential(request.get('value'))
    if (!secret) return response.json({ error: 'value must be the credential, 8 to 4096 characters with no spaces' }, 422)

    const now = new Date().toISOString()
    const previous = await db.selectFrom('integration_credentials' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .where('provider' as any, '=', connector.provider)
      .execute() as { id: number }[]

    const created = await IntegrationCredential.forceCreate({
      team_id: teamId,
      provider: connector.provider,
      // The unique index is (team, provider, name); a stamped name lets the
      // new row exist before the old one is removed, so a failed write never
      // leaves the workspace with no credential.
      name: previous.length > 0 ? `${CONNECTION_NAME} ${now}` : CONNECTION_NAME,
      encryptedValue: secret,
      lastFour: lastFourOf(secret),
      rotatedAt: previous.length > 0 ? now : null,
    } as any)
    const id = Number(created.id)

    if (previous.length > 0) {
      await db.deleteFrom('integration_credentials' as any)
        .where('team_id' as any, '=', teamId)
        .where('provider' as any, '=', connector.provider)
        .where('id' as any, '!=', id)
        .execute()
      await db.updateTable('integration_credentials' as any).set({ name: CONNECTION_NAME } as any)
        .where('id' as any, '=', id).where('team_id' as any, '=', teamId).execute()
    }

    await db.updateTable('monitored_profiles' as any).set({ status: 'active', next_poll_at: now, consecutive_failures: 0, updated_at: now } as any)
      .where('team_id' as any, '=', teamId)
      .where('platform' as any, '=', connector.platform)
      .where('status' as any, '=', 'unconfigured')
      .execute()

    await AuditEvent.forceCreate({
      team_id: teamId,
      user_id: Number(user.id),
      action: previous.length > 0 ? 'integration_credential.rotated' : 'integration_credential.stored',
      subjectType: 'IntegrationCredential',
      subjectId: String(id),
      // The provider, never any part of the secret.
      metadata: JSON.stringify({ provider: connector.provider }),
      occurredAt: now,
    })

    return response.json({ data: { id, provider: connector.provider, last_four: lastFourOf(secret), rotated_at: previous.length > 0 ? now : null, created_at: now } }, 201)
  },
})
