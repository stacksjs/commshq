import { Automation, AutomationRun } from '@stacksjs/orm'
import { Job } from '@stacksjs/queue'
import AutomationStepRun from '../Models/AutomationStepRun'
import AutomationVersion from '../Models/AutomationVersion'

interface AutomationPayload { runId: number, teamId: number }

export default new Job({
  name: 'ProcessAutomationRun', description: 'Executes one immutable automation graph version', queue: 'automations', tries: 5, backoff: [30, 120, 600, 1800],
  async handle(payload: AutomationPayload) {
    const run = await AutomationRun.where('id', payload.runId).where('team_id', payload.teamId).first()
    if (!run || ['completed', 'cancelled'].includes(String(run.status))) return { skipped: true }
    const automation = await Automation.where('id', run.automation_id).where('team_id', payload.teamId).first()
    if (!automation || automation.status !== 'active') throw new Error('Automation is not active')
    const version = await AutomationVersion.where('automation_id', automation.id).where('version', run.version).first()
    if (!version) throw new Error('Published automation version not found')

    const graph = typeof version.graph === 'string' ? JSON.parse(version.graph) : version.graph
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
    await run.update({ status: 'running' })

    for (const node of nodes) {
      const existing = await AutomationStepRun.where('automation_run_id', run.id).where('nodeId', String(node.id)).first()
      if (existing?.status === 'completed') continue
      const step = existing ?? await AutomationStepRun.forceCreate({ team_id: payload.teamId, automation_run_id: run.id, nodeId: String(node.id), type: String(node.type), status: 'running', attempt: 1, idempotencyKey: `automation:${run.id}:${version.version}:${node.id}`, input: JSON.stringify(node.config || {}), startedAt: new Date().toISOString() })
      if (node.type === 'approval') {
        await AutomationStepRun.forceUpdate(step.id, { status: 'waiting' })
        await run.update({ status: 'waiting', currentNodeId: String(node.id) })
        return { waitingForApproval: true, nodeId: node.id }
      }
      if (node.type === 'delay') {
        const seconds = Math.max(1, Number(node.config?.seconds || 60))
        await AutomationStepRun.forceUpdate(step.id, { status: 'waiting' })
        await run.update({ status: 'waiting', currentNodeId: String(node.id) })
        await ProcessAutomationRun.dispatchAfter(seconds, payload)
        return { delayed: seconds, nodeId: node.id }
      }
      await AutomationStepRun.forceUpdate(step.id, { status: 'completed', output: JSON.stringify({ accepted: true }), completedAt: new Date().toISOString() })
    }

    await run.update({ status: 'completed', finishedAt: new Date().toISOString() })
    return { completed: true }
  },
})
