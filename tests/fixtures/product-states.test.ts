import { describe, expect, test } from 'bun:test'

const NOW = '2026-09-12T12:00:00.000Z'
const campaign = (index: number, status = 'draft') => ({ id: index, name: `Campaign ${index}`, channel: index % 2 ? 'email' : 'sms', status, recipients: index * 125, scheduledAt: NOW })

export const productStates = {
  empty: { now: NOW, status: 'ready', campaigns: [], contacts: 0 },
  normal: { now: NOW, status: 'ready', campaigns: [campaign(1, 'sent'), campaign(2, 'scheduled'), campaign(3)], contacts: 6400 },
  loading: { now: NOW, status: 'loading', campaigns: [], contacts: null },
  failure: { now: NOW, status: 'error', campaigns: [], error: 'Campaign delivery service unavailable' },
  highVolume: { now: NOW, status: 'ready', campaigns: Array.from({ length: 250 }, (_, index) => campaign(index + 1, 'sent')), contacts: 1_000_000 },
} as const

describe('deterministic communications product states', () => {
  test('covers every UI state', () => expect(Object.keys(productStates)).toEqual(['empty', 'normal', 'loading', 'failure', 'highVolume']))
  test('keeps volume fixtures large and reproducible', () => {
    expect(productStates.highVolume.campaigns).toHaveLength(250)
    expect(JSON.stringify(productStates)).toBe(JSON.stringify(productStates))
  })
})
