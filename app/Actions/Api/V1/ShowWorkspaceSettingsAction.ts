import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { activeTeam } from '../../../Support/activeTeam'
import { canEditWorkspace } from '../../../Support/workspaceSettings'

/**
 * The caller's workspace settings, and whether the caller may change them.
 * Every member may read them; `canEdit` is advice for the page, and the
 * update route checks the role again.
 */
export default new Action({
  name: 'Show Workspace Settings',
  description: 'Returns the active workspace name and description',
  method: 'GET',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    if (!membership) return response.json({ error: 'Active team required' }, 403)

    const team = await db.selectFrom('teams' as any)
      .select(['id', 'name', 'description', 'created_at'] as any)
      .where('id' as any, '=', membership.teamId)
      .executeTakeFirst() as { id: number, name: string, description: string | null, created_at: string | null } | undefined
    if (!team) return response.json({ error: 'Workspace not found' }, 404)

    return response.json({
      data: {
        id: Number(team.id),
        name: String(team.name || ''),
        description: team.description ? String(team.description) : '',
        created_at: team.created_at ?? null,
        canEdit: canEditWorkspace(membership.role),
      },
    })
  },
})
