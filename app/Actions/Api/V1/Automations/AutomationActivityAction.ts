import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db, sql } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { activeTeam } from '../../../../Support/activeTeam'
import { canonicalGraph, graphChecksum, readRunnableGraph } from '../../../../Support/automationGraph'
import { canEditWorkspace } from '../../../../Support/workspaceSettings'

/**
 * What each of the workspace's automations has done: its latest version,
 * its runs by status, how many emails it has sent, and whether its saved
 * steps differ from the version that is live.
 *
 * Counts only, so every member may read it. `can_publish` says whether the
 * caller may turn automations on, so the page offers the control only to
 * someone it will not refuse.
 */
export default new Action({
  name: 'Automation Activity',
  description: 'Returns run and send counts for the active workspace\'s automations',
  method: 'GET',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    if (!teamId) return response.json({ error: 'Active team required' }, 403)

    const [automations, versions, runs, sent] = await Promise.all([
      db.selectFrom('automations' as any).select(['id', 'graph'] as any).where('team_id' as any, '=', teamId).execute() as unknown as Promise<Array<{ id: number, graph: unknown }>>,
      // The latest version of each, with its checksum, to compare the saved steps against.
      (db as any).selectFrom('automation_versions').select(['automation_id', 'version', 'checksum'])
        .where('team_id', '=', teamId).orderBy('version', 'asc').execute() as Promise<Array<{ automation_id: number, version: number, checksum: string }>>,
      (db as any).selectFrom('automation_runs').select(['automation_id', 'status']).selectRaw(sql`count(*) as n`)
        .where('team_id', '=', teamId).groupBy('automation_id').groupBy('status').execute() as Promise<Array<{ automation_id: number, status: string, n: number }>>,
      (db as any).selectFrom('automation_step_runs').innerJoin('automation_runs', 'automation_runs.id', '=', 'automation_step_runs.automation_run_id')
        .select(['automation_runs.automation_id as automation_id']).selectRaw(sql`count(*) as n`)
        .where('automation_step_runs.team_id', '=', teamId).where('automation_runs.team_id', '=', teamId)
        .where('automation_step_runs.type', '=', 'send_email').where('automation_step_runs.status', '=', 'completed')
        .groupBy('automation_runs.automation_id').execute() as Promise<Array<{ automation_id: number, n: number }>>,
    ])

    const byId = new Map<number, { automation_id: number, version: number, checksum: string, unpublished_changes: boolean, runs: Record<string, number>, emails_sent: number }>()
    const entry = (id: number) => {
      const key = Number(id)
      if (!byId.has(key))
        byId.set(key, { automation_id: key, version: 0, checksum: '', unpublished_changes: false, runs: {}, emails_sent: 0 })
      return byId.get(key)!
    }
    // Ascending, so the last one written for an automation is its latest.
    for (const row of versions) Object.assign(entry(row.automation_id), { version: Number(row.version) || 0, checksum: String(row.checksum) })
    for (const row of runs) entry(row.automation_id).runs[String(row.status)] = Number(row.n) || 0
    for (const row of sent) entry(row.automation_id).emails_sent = Number(row.n) || 0

    for (const automation of automations) {
      const item = entry(automation.id)
      if (!item.version)
        continue
      const { graph } = readRunnableGraph(automation.graph)
      item.unpublished_changes = !graph || graphChecksum(canonicalGraph(graph)) !== item.checksum
    }

    // The checksum is only for the comparison above; it is not the page's business.
    const data = [...byId.values()].map(item => ({ automation_id: item.automation_id, version: item.version, unpublished_changes: item.unpublished_changes, runs: item.runs, emails_sent: item.emails_sent }))
    return response.json({ data, can_publish: canEditWorkspace(membership?.role) })
  },
})
