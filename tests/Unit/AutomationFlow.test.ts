import { describe, expect, it } from 'bun:test'
import { automationDelaySeconds, automationNodes, automationStepKey, isTerminalAutomationStatus } from '../../app/Actions/Automations/flow'

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

  it('bounds delay nodes and defaults invalid values', () => {
    expect(automationDelaySeconds(undefined)).toBe(60)
    expect(automationDelaySeconds('not-a-number')).toBe(60)
    expect(automationDelaySeconds(-20)).toBe(1)
    expect(automationDelaySeconds(4.9)).toBe(4)
    expect(automationDelaySeconds(Number.POSITIVE_INFINITY)).toBe(60)
    expect(automationDelaySeconds(10_000_000)).toBe(2_592_000)
  })

  it('never resumes a completed or cancelled run', () => {
    expect(isTerminalAutomationStatus('completed')).toBe(true)
    expect(isTerminalAutomationStatus('cancelled')).toBe(true)
    expect(isTerminalAutomationStatus('waiting')).toBe(false)
  })
})
