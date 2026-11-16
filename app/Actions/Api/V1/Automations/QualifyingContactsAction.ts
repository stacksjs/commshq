import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { activeTeam } from '../../../../Support/activeTeam'
import { triggerType } from '../../../../Support/automationGraph'
import { ENROLL_LIMIT, qualifyingContacts } from '../../../../Support/automationRunner'

/**
 * How many people already meet an automation's trigger and have never been
 * through it: the number the page shows before asking whether to include
 * them when turning it on. A count, never who, so every member may read it.
 */
export default new Action({
  name: 'Qualifying Contacts',
  description: 'Counts the contacts who already meet an automation\'s trigger',
  method: 'GET',

  async handle(request: RequestInstance) {
    const teamId = (await activeTeam(request))?.teamId ?? null
    if (!teamId) return response.json({ error: 'Active team required' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'Automation id must be a positive integer' }, 422)

    const automation = await db.selectFrom('automations' as any).select(['id', 'trigger'] as any)
      .where('id' as any, '=', id).where('team_id' as any, '=', teamId)
      .executeTakeFirst() as { id: number, trigger: unknown } | undefined
    if (!automation) return response.json({ error: 'Automation not found' }, 404)

    const count = (await qualifyingContacts(teamId, id, triggerType(automation.trigger))).length
    return response.json({ data: { count, limit: ENROLL_LIMIT } })
  },
})
