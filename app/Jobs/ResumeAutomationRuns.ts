import { db } from '@stacksjs/database'
import { Job } from '@stacksjs/queue'
import ProcessAutomationRun from './ProcessAutomationRun'

/**
 * Hand runs back to `ProcessAutomationRun` when they can go on.
 *
 * Every minute, for automations that are active:
 *
 * - runs `waiting` on a step whose `available_at` has passed, which is a
 *   wait that is over or a failed send due another attempt;
 * - runs `queued` for more than a minute, which is one paused part way and
 *   turned back on, or one whose first dispatch was lost;
 * - runs left `running` for over fifteen minutes, which a worker dropped
 *   mid-way. They are put back to `queued` and picked up next minute.
 *
 * The job claims each run before it does anything, so a run handed over
 * twice is only worked once.
 */
const BATCH = 200

export default new Job({
  name: 'ResumeAutomationRuns',
  description: 'Hands due and stalled automation runs back to the runner',
  queue: 'scheduler',
  tries: 1,

  async handle() {
    const now = new Date()
    const nowIso = now.toISOString()
    const minuteAgo = new Date(now.getTime() - 60_000).toISOString()
    const stalled = new Date(now.getTime() - 15 * 60_000).toISOString()

    const reset = await db.updateTable('automation_runs' as any).set({ status: 'queued', updated_at: nowIso } as any)
      .where('status' as any, '=', 'running').where('updated_at' as any, '<', stalled).executeTakeFirst() as { numUpdatedRows?: bigint | number }

    const due = await (db as any).selectFrom('automation_step_runs')
      .innerJoin('automation_runs', 'automation_runs.id', '=', 'automation_step_runs.automation_run_id')
      .innerJoin('automations', 'automations.id', '=', 'automation_runs.automation_id')
      .select(['automation_runs.id as run_id', 'automation_runs.team_id as team_id'])
      .where('automation_step_runs.status', 'in', ['waiting', 'failed'])
      .where('automation_step_runs.available_at', '<=', nowIso)
      .where('automation_runs.status', '=', 'waiting')
      .where('automations.status', '=', 'active')
      .limit(BATCH)
      .execute() as Array<{ run_id: number, team_id: number }>

    const queued = await (db as any).selectFrom('automation_runs')
      .innerJoin('automations', 'automations.id', '=', 'automation_runs.automation_id')
      .select(['automation_runs.id as run_id', 'automation_runs.team_id as team_id'])
      .where('automation_runs.status', '=', 'queued')
      .where('automation_runs.updated_at', '<=', minuteAgo)
      .where('automations.status', '=', 'active')
      .limit(BATCH)
      .execute() as Array<{ run_id: number, team_id: number }>

    const runs = new Map<number, number>()
    for (const row of [...due, ...queued])
      runs.set(Number(row.run_id), Number(row.team_id))
    for (const [runId, teamId] of runs)
      await ProcessAutomationRun.dispatch({ runId, teamId })

    return { resumed: runs.size, reset: Number(reset?.numUpdatedRows ?? 0) }
  },
})
