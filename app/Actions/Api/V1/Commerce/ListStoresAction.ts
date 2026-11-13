import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { activeTeam } from '../../../../Support/activeTeam'
import { canManageCommerce, STORE_PROVIDERS, storeEndpoint, webhookPath, webhookUrl } from '../../../../Support/commerceStores'

/**
 * The stores a workspace has connected, each with where it sends webhooks
 * and what has arrived.
 *
 * The generated list of connections cannot say where a store should post,
 * since that address belongs to a different row. This joins the two, and
 * counts the events recorded and the deliveries that failed, so the page
 * can tell a quiet store from a broken one.
 *
 * Every member may read it. The address is not a secret: a webhook is only
 * accepted with a valid signature, and the secret never leaves the server.
 */
export default new Action({
  name: 'List Stores',
  description: 'Returns the connected stores of the active workspace with their webhook addresses and event counts',
  method: 'GET',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    if (!teamId) return response.json({ error: 'Active team required' }, 403)

    const stores = await db.selectFrom('commerce_connections' as any)
      .select(['id', 'provider', 'name', 'status', 'created_at'] as any)
      .where('team_id' as any, '=', teamId)
      .where('provider' as any, 'in', [...STORE_PROVIDERS])
      .orderBy('id' as any, 'asc')
      .execute() as Array<{ id: number, provider: string, name: string, status: string, created_at: string | null }>

    const data = await Promise.all(stores.map(async (store) => {
      const [endpoint, events, latest, failed] = await Promise.all([
        storeEndpoint(teamId, store.provider),
        (db as any).selectFrom('commerce_events').where('team_id', '=', teamId).where('commerce_connection_id', '=', store.id).count(),
        db.selectFrom('commerce_events' as any).select(['occurred_at'] as any).where('team_id' as any, '=', teamId).where('commerce_connection_id' as any, '=', store.id).orderBy('occurred_at' as any, 'desc').executeTakeFirst() as Promise<{ occurred_at: string } | undefined>,
        (db as any).selectFrom('webhook_events').where('team_id', '=', teamId).where('provider', '=', store.provider).where('status', 'in', ['failed', 'dead_lettered']).count(),
      ])
      return {
        id: Number(store.id),
        provider: store.provider,
        name: store.name,
        status: store.status,
        created_at: store.created_at,
        // Null when the endpoint is gone: the store cannot receive anything.
        webhook_path: endpoint ? webhookPath(store.provider, endpoint.uuid) : null,
        webhook_url: endpoint ? webhookUrl(store.provider, endpoint.uuid) : null,
        endpoint_status: endpoint?.status ?? null,
        events: Number(events) || 0,
        last_event_at: latest?.occurred_at ?? null,
        failed_deliveries: Number(failed) || 0,
      }
    }))

    return response.json({ data, can_manage: canManageCommerce(membership?.role) })
  },
})
