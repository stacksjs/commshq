import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { activeTeam } from '../../../../Support/activeTeam'

/**
 * A team's sending domains, with the record each one must publish.
 *
 * Every member may read this: whether a domain is verified explains why a
 * send did or did not go out, which is not an admin-only question. The
 * verification record is in the answer because it is not a secret. It is
 * meant to be published in DNS.
 */
export default new Action({
  name: 'List Sender Domains',
  description: 'Lists the active team sending domains and their verification records',
  method: 'GET',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)

    const rows = await db.selectFrom('sender_domains' as any)
      .select(['id', 'domain', 'status', 'dns_records', 'verified_at', 'last_checked_at', 'created_at'] as any)
      .where('team_id' as any, '=', teamId)
      .orderBy('domain' as any, 'asc')
      .execute()

    return response.json({ data: rows })
  },
})
