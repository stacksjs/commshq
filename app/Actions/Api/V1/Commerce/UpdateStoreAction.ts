import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../../Models/AuditEvent'
import WebhookEndpoint from '../../../../Models/WebhookEndpoint'
import { activeTeam } from '../../../../Support/activeTeam'
import { canManageCommerce, normalizeStoreSecret, STORE_PROVIDERS, STORE_STATUS_ENDPOINT, storeEndpoint } from '../../../../Support/commerceStores'

/**
 * Pause or resume a store, or replace its signing secret.
 *
 * A status change moves the connection and its endpoint together: a paused
 * store's webhooks are refused at the door rather than accepted and then
 * failed. A new secret replaces the old one at once, so the store has to be
 * using it already, or be changed straight after.
 *
 * In place of the generated update, which any member could call and which
 * could set a connection active with no endpoint behind it.
 */
export default new Action({
  name: 'Update Store',
  description: 'Pauses or resumes a connected store, or replaces its signing secret',
  method: 'PATCH',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageCommerce(membership?.role)) return response.json({ error: 'Changing a store requires an admin or owner role' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'Store id must be a positive integer' }, 422)

    const rawStatus = request.get('status')
    const rawSecret = request.get('secret')
    const status = rawStatus == null ? undefined : String(rawStatus)
    if (status !== undefined && !(status in STORE_STATUS_ENDPOINT)) return response.json({ error: 'status must be active or disabled' }, 422)
    const secret = rawSecret == null ? undefined : normalizeStoreSecret(rawSecret)
    if (rawSecret != null && !secret) return response.json({ error: 'secret must be the signing secret, 8 to 4096 characters with no spaces' }, 422)
    if (status === undefined && secret === undefined) return response.json({ error: 'Send a status or a secret to change' }, 422)

    const store = await db.selectFrom('commerce_connections' as any)
      .select(['id', 'provider', 'name'] as any)
      .where('id' as any, '=', id)
      .where('team_id' as any, '=', teamId)
      .where('provider' as any, 'in', [...STORE_PROVIDERS])
      .executeTakeFirst() as { id: number, provider: string, name: string } | undefined
    if (!store) return response.json({ error: 'Store not found' }, 404)

    const endpoint = await storeEndpoint(teamId, store.provider)
    if (!endpoint) return response.json({ error: 'This store has no webhook endpoint, so it cannot be changed' }, 409)

    const now = new Date().toISOString()
    if (secret !== undefined)
      await WebhookEndpoint.forceUpdate(endpoint.id, { encryptedSecret: secret } as any)

    if (status !== undefined) {
      await db.updateTable('webhook_endpoints' as any).set({ status: STORE_STATUS_ENDPOINT[status], updated_at: now } as any)
        .where('id' as any, '=', endpoint.id).where('team_id' as any, '=', teamId).execute()
      await db.updateTable('commerce_connections' as any).set({ status, updated_at: now } as any)
        .where('id' as any, '=', id).where('team_id' as any, '=', teamId).execute()
    }

    await AuditEvent.forceCreate({
      team_id: teamId,
      user_id: Number(user.id),
      action: secret !== undefined ? 'commerce_store.secret_replaced' : (status === 'active' ? 'commerce_store.resumed' : 'commerce_store.paused'),
      subjectType: 'CommerceConnection',
      subjectId: String(id),
      metadata: JSON.stringify({ provider: store.provider, status: status ?? null, secret_replaced: secret !== undefined }),
      occurredAt: now,
    })

    return response.json({ data: { id, provider: store.provider, status: status ?? null, secret_replaced: secret !== undefined } })
  },
})
