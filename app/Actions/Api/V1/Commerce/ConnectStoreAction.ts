import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../../Models/AuditEvent'
import CommerceConnection from '../../../../Models/CommerceConnection'
import WebhookEndpoint from '../../../../Models/WebhookEndpoint'
import { activeTeam } from '../../../../Support/activeTeam'
import { canManageCommerce, normalizeStoreName, normalizeStoreSecret, storeEndpoint, storeProvider, webhookPath, webhookUrl } from '../../../../Support/commerceStores'

/**
 * Connect a store: the endpoint its webhooks arrive at, and the connection
 * that lets them be recorded.
 *
 * The signing secret goes in through `forceCreate`, the write the model
 * encrypts, and it never comes back. The answer carries the address to give
 * the store.
 *
 * The endpoint is written first. If the connection then fails, what is left
 * is an endpoint that accepts signed webhooks nobody records, which the job
 * reports as an error; the other order would leave a connection that looks
 * live and can receive nothing.
 */
export default new Action({
  name: 'Connect Store',
  description: 'Creates the webhook endpoint and commerce connection for one store',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageCommerce(membership?.role)) return response.json({ error: 'Connecting a store requires an admin or owner role' }, 403)

    const provider = storeProvider(request.get('provider'))
    if (!provider) return response.json({ error: 'provider must be shopify or woocommerce' }, 422)

    const name = normalizeStoreName(request.get('name'))
    if (!name) return response.json({ error: 'name must be 2 to 120 characters' }, 422)

    const secret = normalizeStoreSecret(request.get('secret'))
    if (!secret) return response.json({ error: 'secret must be the signing secret, 8 to 4096 characters with no spaces' }, 422)

    const existing = await db.selectFrom('commerce_connections' as any).select(['id'] as any)
      .where('team_id' as any, '=', teamId).where('provider' as any, '=', provider).executeTakeFirst()
    if (existing || await storeEndpoint(teamId, provider))
      return response.json({ error: 'This workspace already has a store connected for that provider' }, 409)

    const endpoint = await WebhookEndpoint.forceCreate({
      team_id: teamId,
      name,
      provider,
      direction: 'inbound',
      encryptedSecret: secret,
      events: JSON.stringify(['orders']),
      status: 'active',
    } as any)

    const connection = await CommerceConnection.forceCreate({
      team_id: teamId,
      provider,
      name,
      status: 'active',
    } as any)

    const now = new Date().toISOString()
    await AuditEvent.forceCreate({
      team_id: teamId,
      user_id: Number(user.id),
      action: 'commerce_store.connected',
      subjectType: 'CommerceConnection',
      subjectId: String(connection.id),
      // The provider and name, never any part of the secret.
      metadata: JSON.stringify({ provider, name }),
      occurredAt: now,
    })

    const uuid = String(endpoint.uuid)
    return response.json({
      data: { id: Number(connection.id), provider, name, status: 'active', webhook_path: webhookPath(provider, uuid), webhook_url: webhookUrl(provider, uuid), created_at: now },
    }, 201)
  },
})
