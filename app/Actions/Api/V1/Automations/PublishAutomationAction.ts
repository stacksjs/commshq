import type { RequestInstance } from '@stacksjs/types'
import { randomUUID } from 'node:crypto'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../../Models/AuditEvent'
import { activeTeam } from '../../../../Support/activeTeam'
import { canonicalGraph, graphChecksum, readRunnableGraph, TRIGGER_TYPES, triggerType } from '../../../../Support/automationGraph'
import { latestVersion, verifiedSender } from '../../../../Support/automationRunner'
import { canEditWorkspace } from '../../../../Support/workspaceSettings'

/**
 * Turn an automation on: freeze its steps as a version, and mark it active.
 *
 * The steps are checked first, whole: every step must be one that can run,
 * and the sender must be verified at a verified domain. A version is
 * immutable, so a run that has started keeps the steps it started with
 * whatever is edited later; turning on again after an edit makes the next
 * version, and new runs use that.
 *
 * Turning on a paused automation whose steps have not changed reuses the
 * latest version rather than making an identical one, so this is also how
 * an automation is resumed.
 *
 * An admin or owner only. Once on, an automation sends email to every new
 * subscriber without anyone pressing anything again.
 */
export default new Action({
  name: 'Publish Automation',
  description: 'Freezes an automation\'s steps as a version and turns it on',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canEditWorkspace(membership?.role)) return response.json({ error: 'Turning an automation on requires an admin or owner role' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'Automation id must be a positive integer' }, 422)

    const automation = await db.selectFrom('automations' as any)
      .select(['id', 'name', 'status', 'trigger', 'graph'] as any)
      .where('id' as any, '=', id)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst() as { id: number, name: string, status: string, trigger: unknown, graph: unknown } | undefined
    if (!automation) return response.json({ error: 'Automation not found' }, 404)
    if (automation.status === 'archived') return response.json({ error: 'Restore this automation as a draft before turning it on' }, 409)

    const trigger = triggerType(automation.trigger)
    if (!(TRIGGER_TYPES as readonly string[]).includes(trigger))
      return response.json({ error: 'This automation has a trigger that nothing fires' }, 422)

    const { graph, error } = readRunnableGraph(automation.graph)
    if (!graph) return response.json({ error }, 422)
    if (!await verifiedSender(teamId, graph.senderIdentityId))
      return response.json({ error: 'The sender must be a verified sender at a verified domain' }, 422)

    const canonical = canonicalGraph(graph)
    const checksum = graphChecksum(canonical)
    const latest = await latestVersion(teamId, id)
    const now = new Date().toISOString()

    let version = latest ? Number(latest.version) : 0
    const reused = !!latest && latest.checksum === checksum
    if (!reused) {
      version += 1
      await db.insertInto('automation_versions' as any).values({
        team_id: teamId,
        automation_id: id,
        uuid: randomUUID(),
        version,
        graph: canonical,
        checksum,
        published_by: Number(user.id),
        published_at: now,
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    await db.updateTable('automations' as any)
      .set({ status: 'active', version, published_at: now, updated_at: now } as any)
      .where('id' as any, '=', id).where('team_id' as any, '=', teamId).execute()

    await AuditEvent.forceCreate({
      team_id: teamId,
      user_id: Number(user.id),
      action: reused ? 'automation.resumed' : 'automation.published',
      subjectType: 'Automation',
      subjectId: String(id),
      metadata: JSON.stringify({ version, steps: graph.steps.length }),
      occurredAt: now,
    })

    return response.json({ data: { id, status: 'active', version, new_version: !reused, published_at: now } })
  },
})
