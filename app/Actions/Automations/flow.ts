export interface AutomationNode {
  id: string | number
  type: string
  config?: Record<string, unknown>
}

const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60

export function automationNodes(value: unknown): AutomationNode[] {
  const graph = typeof value === 'string' ? JSON.parse(value) : value
  if (!graph || typeof graph !== 'object' || !Array.isArray((graph as any).nodes))
    return []
  return (graph as any).nodes.filter((node: unknown): node is AutomationNode => {
    return !!node && typeof node === 'object' && ['string', 'number'].includes(typeof (node as any).id) && typeof (node as any).type === 'string'
  })
}

export function automationStepKey(runId: string | number, version: string | number, nodeId: string | number): string {
  return `automation:${runId}:${version}:${nodeId}`
}

export function automationDelaySeconds(value: unknown): number {
  if (value == null || value === '')
    return 60
  const seconds = Number(value)
  if (!Number.isFinite(seconds))
    return 60
  return Math.min(MAX_DELAY_SECONDS, Math.max(1, Math.trunc(seconds)))
}

export function isTerminalAutomationStatus(value: unknown): boolean {
  return value === 'completed' || value === 'cancelled'
}
