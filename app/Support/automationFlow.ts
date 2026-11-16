export interface AutomationNode {
  id: string | number
  type: string
  config?: Record<string, unknown>
}

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
