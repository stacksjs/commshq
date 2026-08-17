import type { AlertRuleInput, EvaluableMention } from '../../app/Actions/Reputation/thresholds'
import { describe, expect, it } from 'bun:test'
import { parseChannels } from '../../app/Actions/Reputation/notify-alert'
import {
  alertFingerprint,
  breaches,
  computeMetric,
  evaluateRule,
  parseComparator,
  parseMetric,
  withinCooldown,
} from '../../app/Actions/Reputation/thresholds'

const NOW = new Date('2026-03-10T12:00:00.000Z')

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString()
}

function mention(overrides: Partial<EvaluableMention> = {}): EvaluableMention {
  return {
    platform: 'google_business',
    sentiment: 'negative',
    sentimentScore: -60,
    rating: 2,
    status: 'new',
    postedAt: minutesAgo(30),
    ...overrides,
  }
}

function rule(overrides: Partial<AlertRuleInput> = {}): AlertRuleInput {
  return {
    id: 1,
    metric: 'negative_mention_count',
    comparator: 'gte',
    threshold: 3,
    windowMinutes: 1_440,
    minimumSampleSize: 1,
    platforms: [],
    cooldownMinutes: 360,
    lastTriggeredAt: null,
    ...overrides,
  }
}

describe('reputation metrics', () => {
  it('counts negative mentions against the whole sample', () => {
    const mentions = [mention(), mention(), mention({ sentiment: 'positive', rating: 5 })]
    expect(computeMetric('negative_mention_count', mentions)).toEqual({ value: 2, sampleSize: 3 })
  })

  it('counts only unanswered negative mentions', () => {
    const mentions = [mention({ status: 'new' }), mention({ status: 'responded' }), mention({ status: 'triaged' })]
    expect(computeMetric('unanswered_negative_count', mentions).value).toBe(2)
  })

  it('averages only the mentions that carry a rating', () => {
    const mentions = [mention({ rating: 5 }), mention({ rating: 3 }), mention({ rating: null })]
    expect(computeMetric('average_rating', mentions)).toEqual({ value: 4, sampleSize: 2 })
  })

  it('reports no value for an average with nothing to average', () => {
    expect(computeMetric('average_rating', [mention({ rating: null })])).toEqual({ value: null, sampleSize: 0 })
  })

  it('excludes unscored mentions from the sentiment average', () => {
    const mentions = [mention({ sentimentScore: -100 }), mention({ sentiment: 'unknown', sentimentScore: 0 })]
    expect(computeMetric('average_sentiment', mentions)).toEqual({ value: -100, sampleSize: 1 })
  })
})

describe('threshold comparison', () => {
  it('compares in the declared direction', () => {
    expect(breaches('gte', 3, 3)).toBe(true)
    expect(breaches('gte', 2, 3)).toBe(false)
    expect(breaches('lte', 3.0, 3.5)).toBe(true)
    expect(breaches('lte', 4.0, 3.5)).toBe(false)
  })

  it('parses only supported metrics and comparators', () => {
    expect(parseMetric('average_rating')).toBe('average_rating')
    expect(parseMetric('made_up')).toBeNull()
    expect(parseComparator('LTE')).toBe('lte')
    expect(parseComparator('eq')).toBeNull()
  })
})

describe('rule evaluation', () => {
  it('fires when the metric breaches the threshold', () => {
    const result = evaluateRule(rule(), [mention(), mention(), mention()], NOW)
    expect(result.breached).toBe(true)
    expect(result.value).toBe(3)
  })

  it('ignores mentions posted outside the window', () => {
    const mentions = [mention(), mention(), mention({ postedAt: minutesAgo(2_000) })]
    const result = evaluateRule(rule(), mentions, NOW)
    expect(result.breached).toBe(false)
    expect(result.value).toBe(2)
    expect(result.reason).toBe('within_threshold')
  })

  it('ignores platforms the rule does not scope to', () => {
    const mentions = [mention({ platform: 'yelp' }), mention(), mention()]
    const result = evaluateRule(rule({ platforms: ['google_business'] }), mentions, NOW)
    expect(result.value).toBe(2)
  })

  it('holds fire until the minimum sample size is met', () => {
    const result = evaluateRule(rule({ metric: 'average_rating', comparator: 'lte', threshold: 3, minimumSampleSize: 5 }), [mention({ rating: 1 })], NOW)
    expect(result.breached).toBe(false)
    expect(result.reason).toBe('below_minimum_sample')
  })

  it('reports no data rather than firing on an empty average', () => {
    const result = evaluateRule(rule({ metric: 'average_rating', comparator: 'lte', threshold: 3 }), [], NOW)
    expect(result.breached).toBe(false)
    expect(result.reason).toBe('no_data')
  })

  it('stays quiet while the rule is cooling down', () => {
    const cooling = rule({ lastTriggeredAt: minutesAgo(60), cooldownMinutes: 360 })
    expect(evaluateRule(cooling, [mention(), mention(), mention()], NOW).reason).toBe('cooling_down')
  })

  it('fires again once the cooldown has elapsed', () => {
    const elapsed = rule({ lastTriggeredAt: minutesAgo(400), cooldownMinutes: 360 })
    expect(evaluateRule(elapsed, [mention(), mention(), mention()], NOW).breached).toBe(true)
  })

  it('treats a malformed last trigger time as not cooling down', () => {
    expect(withinCooldown({ cooldownMinutes: 60, lastTriggeredAt: 'not-a-date' }, NOW)).toBe(false)
  })

  it('fires a rating rule on a fractional average', () => {
    const mentions = [mention({ rating: 4 }), mention({ rating: 5 }), mention({ rating: 3 }), mention({ rating: 1 })]
    const result = evaluateRule(rule({ metric: 'average_rating', comparator: 'lte', threshold: 3.5, minimumSampleSize: 4 }), mentions, NOW)
    expect(result.breached).toBe(true)
    expect(result.value).toBe(3.25)
  })
})

describe('alert identity', () => {
  it('is stable for the same rule and window', () => {
    const first = alertFingerprint({ teamId: 1, ruleId: 2, windowStart: minutesAgo(60) })
    const second = alertFingerprint({ teamId: 1, ruleId: 2, windowStart: minutesAgo(60) })
    expect(first).toBe(second)
  })

  it('separates teams, rules, and windows', () => {
    const base = { teamId: 1, ruleId: 2, windowStart: minutesAgo(60) }
    expect(alertFingerprint(base)).not.toBe(alertFingerprint({ ...base, teamId: 2 }))
    expect(alertFingerprint(base)).not.toBe(alertFingerprint({ ...base, ruleId: 3 }))
    expect(alertFingerprint(base)).not.toBe(alertFingerprint({ ...base, windowStart: minutesAgo(30) }))
  })
})

describe('alert channels', () => {
  it('always keeps the in-app record', () => {
    expect(parseChannels(JSON.stringify(['email']))).toEqual(['database', 'email'])
    expect(parseChannels(JSON.stringify(['database', 'sms']))).toEqual(['database', 'sms'])
  })

  it('drops unsupported channels and survives malformed input', () => {
    expect(parseChannels(JSON.stringify(['email', 'carrier-pigeon']))).toEqual(['database', 'email'])
    expect(parseChannels('not json')).toEqual(['database'])
    expect(parseChannels(null)).toEqual(['database'])
  })
})
