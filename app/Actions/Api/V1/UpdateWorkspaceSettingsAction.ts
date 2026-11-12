import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../Models/AuditEvent'
import { activeTeam } from '../../../Support/activeTeam'
import { canEditWorkspace, normalizeWorkspaceDescription, normalizeWorkspaceName } from '../../../Support/workspaceSettings'

/**
 * Rename the caller's workspace or change its description.
 *
 * The team is the caller's active one, never one named in the request, so
 * there is no id to point at someone else's workspace. Only the two fields
 * are read; status and member count are not settable from here.
 */
export default new Action({
  name: 'Update Workspace Settings',
  description: 'Changes the active workspace name and description',
  method: 'PATCH',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const user = await request.user()
    if (!membership || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canEditWorkspace(membership.role)) return response.json({ error: 'Changing workspace settings requires an admin or owner role' }, 403)

    const name = normalizeWorkspaceName(request.get('name'))
    if (!name) return response.json({ error: 'name must be 2 to 80 characters on one line' }, 422)

    const description = normalizeWorkspaceDescription(request.get('description'))
    if (description === undefined) return response.json({ error: 'description must be 280 characters or fewer' }, 422)

    const teamId = membership.teamId
    const before = await db.selectFrom('teams' as any).select(['name'] as any).where('id' as any, '=', teamId).executeTakeFirst() as { name: string } | undefined
    if (!before) return response.json({ error: 'Workspace not found' }, 404)

    const now = new Date().toISOString()
    await db.updateTable('teams' as any).set({ name, description, updated_at: now } as any).where('id' as any, '=', teamId).execute()

    await AuditEvent.forceCreate({
      team_id: teamId,
      user_id: Number(user.id),
      action: 'workspace.settings_updated',
      subjectType: 'Team',
      subjectId: String(teamId),
      metadata: JSON.stringify({ from: String(before.name), to: name }),
      occurredAt: now,
    })

    return response.json({ data: { id: teamId, name, description: description ?? '', canEdit: true } })
  },
})
