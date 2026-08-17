import { createHash } from 'node:crypto'
import type { ReputationPlatform } from './platforms'

export const ALERT_METRICS = [
  'negative_mention_count',
  'mention_volume',
  'average_rating',
  'average_sentiment',
  'unanswered_negative_count',
] as const

export type AlertMetric = typeof ALERT_METRICS[number]
export type Comparator = 'gte' | 'lte'
export type Severity = 'info' | 'warning' | 'critical'

/** The mention fields the evaluator needs; deliberately narrower than the model row. */
export interface EvaluableMention {
  platform: ReputationPlatform | string
  sentiment: string
  sentimentScore: number
  rating: number | null
  status: string
  postedAt: string
}

export interface AlertRuleInput {
  id: number
  metric: AlertMetric
  comparator: Comparator
  threshold: number
  windowMinutes: number
  minimumSampleSize: number
  /** Empty means every platform the workspace monitors. */
  platforms: readonly string[]
  cooldownMinutes: number
  lastTriggeredAt: string | null
}

export interface MetricComputation {
  /** Null when the metric is undefined for the sample, e.g. an average with no ratings. */
  value: number | null
  /** Rows that actually contributed to `value`, which is what the minimum sample size gates on. */
  sampleSize: number
}

export interface EvaluationResult {
  breached: boolean
  value: number | null
  sampleSize: number
  windowStart: string
  windowEnd: string
  /** Present whenever the rule did not fire, so operators can see why. */
  reason?: 'no_data' | 'below_minimum_sample' | 'within_threshold' | 'cooling_down'
}

export function parseMetric(value: unknown): AlertMetric | null {
  const metric = String(value || '').toLowerCase()
  return ALERT_METRICS.includes(metric as AlertMetric) ? metric as AlertMetric : null
}

export function parseComparator(value: unknown): Comparator | null {
  const comparator = String(value || '').toLowerCase()
  return comparator === 'gte' || comparator === 'lte' ? comparator : null
}

function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

export function computeMetric(metric: AlertMetric, mentions: readonly EvaluableMention[]): MetricComputation {
  switch (metric) {
    case 'mention_volume':
      return { value: mentions.length, sampleSize: mentions.length }

    case 'negative_mention_count': {
      const negative = mentions.filter(mention => mention.sentiment === 'negative')
      return { value: negative.length, sampleSize: mentions.length }
    }

    case 'unanswered_negative_count': {
      const unanswered = mentions.filter(mention => mention.sentiment === 'negative' && (mention.status === 'new' || mention.status === 'triaged'))
      return { value: unanswered.length, sampleSize: mentions.length }
    }

    case 'average_rating': {
      const ratings = mentions
        .map(mention => mention.rating)
        .filter((rating): rating is number => typeof rating === 'number' && Number.isFinite(rating))
      return { value: mean(ratings), sampleSize: ratings.length }
    }

    case 'average_sentiment': {
      const scores = mentions
        .filter(mention => mention.sentiment !== 'unknown')
        .map(mention => Number(mention.sentimentScore) || 0)
      return { value: mean(scores), sampleSize: scores.length }
    }
  }
}

export function breaches(comparator: Comparator, value: number, threshold: number): boolean {
  return comparator === 'gte' ? value >= threshold : value <= threshold
}

export function windowFor(rule: Pick<AlertRuleInput, 'windowMinutes'>, now: Date): { windowStart: string, windowEnd: string } {
  return {
    windowStart: new Date(now.getTime() - rule.windowMinutes * 60_000).toISOString(),
    windowEnd: now.toISOString(),
  }
}

export function withinCooldown(rule: Pick<AlertRuleInput, 'cooldownMinutes' | 'lastTriggeredAt'>, now: Date): boolean {
  if (!rule.lastTriggeredAt) return false
  const last = Date.parse(rule.lastTriggeredAt)
  if (!Number.isFinite(last)) return false
  return now.getTime() - last < rule.cooldownMinutes * 60_000
}

export function matchesPlatforms(rule: Pick<AlertRuleInput, 'platforms'>, mention: Pick<EvaluableMention, 'platform'>): boolean {
  return rule.platforms.length === 0 || rule.platforms.includes(mention.platform)
}

/**
 * Decide whether a rule fires for the mentions currently in its window.
 *
 * Cooldown is checked first so a rule that is still quiet does not do the work
 * of computing a metric it cannot act on.
 */
export function evaluateRule(rule: AlertRuleInput, mentions: readonly EvaluableMention[], now: Date): EvaluationResult {
  const { windowStart, windowEnd } = windowFor(rule, now)

  if (withinCooldown(rule, now))
    return { breached: false, value: null, sampleSize: 0, windowStart, windowEnd, reason: 'cooling_down' }

  const windowStartMs = Date.parse(windowStart)
  const scoped = mentions.filter((mention) => {
    if (!matchesPlatforms(rule, mention)) return false
    const posted = Date.parse(mention.postedAt)
    return Number.isFinite(posted) && posted >= windowStartMs && posted <= now.getTime()
  })

  const { value, sampleSize } = computeMetric(rule.metric, scoped)

  if (value === null)
    return { breached: false, value: null, sampleSize, windowStart, windowEnd, reason: 'no_data' }

  if (sampleSize < rule.minimumSampleSize)
    return { breached: false, value, sampleSize, windowStart, windowEnd, reason: 'below_minimum_sample' }

  if (!breaches(rule.comparator, value, rule.threshold))
    return { breached: false, value, sampleSize, windowStart, windowEnd, reason: 'within_threshold' }

  return { breached: true, value, sampleSize, windowStart, windowEnd }
}

/**
 * Identity for a firing, used as a unique key so a retried job or an
 * overlapping evaluation cannot open the same alert twice. The window start is
 * included so the next window can legitimately raise a fresh alert.
 */
export function alertFingerprint(input: { teamId: number, ruleId: number, windowStart: string }): string {
  return createHash('sha256')
    .update(`${input.teamId}:${input.ruleId}:${input.windowStart}`)
    .digest('hex')
    .slice(0, 64)
}

export function severityRank(severity: Severity): number {
  return severity === 'critical' ? 3 : severity === 'warning' ? 2 : 1
}
