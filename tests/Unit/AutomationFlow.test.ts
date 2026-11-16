import { describe, expect, it } from 'bun:test'
import { automationNodes, automationStepKey } from '../../app/Support/automationFlow'

describe('automation flow contracts', () => {
  it('reads the immutable graph from JSON or an object', () => {
    const graph = { nodes: [{ id: 'welcome', type: 'email', config: { template: 7 } }, { id: 'wait', type: 'delay', config: { seconds: 30 } }] }
    expect(automationNodes(graph)).toEqual(graph.nodes)
    expect(automationNodes(JSON.stringify(graph))).toEqual(graph.nodes)
  })

  it('drops malformed nodes instead of creating unusable step rows', () => {
    expect(automationNodes({ nodes: [null, {}, { id: 'ok', type: 'email' }, { id: [], type: 'sms' }] }))
      .toEqual([{ id: 'ok', type: 'email' }])
    expect(automationNodes({})).toEqual([])
  })

  it('builds stable step idempotency keys for retries', () => {
    expect(automationStepKey(42, 3, 'welcome')).toBe('automation:42:3:welcome')
  })
})
