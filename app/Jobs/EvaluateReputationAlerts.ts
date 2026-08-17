import type { AlertMetric, Comparator, EvaluableMention, Severity } from '../Actions/Reputation/thresholds'
import { log } from '@stacksjs/logging'
import { isUniqueViolation } from '@stacksjs/orm'
import { Job } from '@stacksjs/queue'
import { deliverAlert, parseChannels } from '../Actions/Reputation/notify-alert'
import { alertFingerprint, evaluateRule } from '../Actions/Reputation/thresholds'
import ReputationAlert from '../Models/ReputationAlert'
import ReputationAlertRule from '../Models/ReputationAlertRule'
import ReputationMention from '../Models/ReputationMention'

const BATCH_SIZE = 200
/** Bounds the rows a single rule pulls, so a busy workspace cannot stall the tick. */
const MENTION_LIMIT = 5_000

function parsePlatforms(value: unknown): string[] {
  if (typeof value !== 'string') return Array.isArray(value) ? value.map(String) : []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  }
  catch {
    return []
  }
}

/**
 * Re-check a rule on a cadence proportional to its window: a 1 hour window is
 * worth looking at every 10 minutes, a 30 day window is not.
 */
function nextEvaluationFor(windowMinutes: number): string {
  const cadence = Math.min(60, Math.max(5, Math.round(windowMinutes / 6)))
  return new Date(Date.now() + cadence * 60_000).toISOString()
}

export default new Job({
  name: 'EvaluateReputationAlerts',
  description: 'Evaluates reputation alert rules and raises alerts when thresholds are breached',
  queue: 'scheduler',
  tries: 3,
  backoff: [30, 120],

  async handle() {
    const now = new Date()
    const rules = await ReputationAlertRule
      .where('status', 'active')
      .where('nextEvaluationAt', '<=', now.toISOString())
      .orderBy('nextEvaluationAt')
      .limit(BATCH_SIZE)
      .get()

    let raised = 0

    for (const rule of rules) {
      const teamId = Number(rule.team_id)
      const windowMinutes = Number(rule.windowMinutes) || 1_440
      const windowStart = new Date(now.getTime() - windowMinutes * 60_000).toISOString()

      try {
        const rows = await ReputationMention
          .where('team_id', teamId)
          .where('postedAt', '>=', windowStart)
          .limit(MENTION_LIMIT)
          .get()

        const mentions: EvaluableMention[] = rows.map(row => ({
          platform: String(row.platform),
          sentiment: String(row.sentiment),
          sentimentScore: Number(row.sentimentScore) || 0,
          rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
          status: String(row.status),
          postedAt: String(row.postedAt),
        }))

        const result = evaluateRule({
          id: Number(rule.id),
          metric: String(rule.metric) as AlertMetric,
          comparator: String(rule.comparator) as Comparator,
          threshold: Number(rule.threshold),
          windowMinutes,
          minimumSampleSize: Number(rule.minimumSampleSize) || 1,
          platforms: parsePlatforms(rule.platforms),
          cooldownMinutes: Number(rule.cooldownMinutes) || 360,
          lastTriggeredAt: rule.lastTriggeredAt ? String(rule.lastTriggeredAt) : null,
        }, mentions, now)

        if (!result.breached) {
          await ReputationAlertRule.forceUpdate(rule.id, {
            lastEvaluatedAt: now.toISOString(),
            nextEvaluationAt: nextEvaluationFor(windowMinutes),
          })
          continue
        }

        const severity = String(rule.severity) as Severity
        const fingerprint = alertFingerprint({ teamId, ruleId: Number(rule.id), windowStart: result.windowStart })

        let alert
        try {
          alert = await ReputationAlert.forceCreate({
            team_id: teamId,
            reputation_alert_rule_id: Number(rule.id),
            fingerprint,
            metric: String(rule.metric),
            severity,
            observedValue: Number(result.value),
            thresholdValue: Number(rule.threshold),
            sampleSize: result.sampleSize,
            windowStart: result.windowStart,
            windowEnd: result.windowEnd,
            status: 'open',
            context: JSON.stringify({
              ruleName: String(rule.name),
              comparator: String(rule.comparator),
              platforms: parsePlatforms(rule.platforms),
              windowMinutes,
            }),
            notifiedChannels: JSON.stringify([]),
          })
        }
        catch (error) {
          // The fingerprint unique index makes a concurrent or retried tick a
          // no-op rather than a duplicate page.
          if (isUniqueViolation(error)) {
            await ReputationAlertRule.forceUpdate(rule.id, {
              lastEvaluatedAt: now.toISOString(),
              nextEvaluationAt: nextEvaluationFor(windowMinutes),
            })
            continue
          }
          throw error
        }

        // Mark the rule triggered before notifying: if delivery throws, the
        // cooldown still holds and the workspace is not paged repeatedly.
        await ReputationAlertRule.forceUpdate(rule.id, {
          lastEvaluatedAt: now.toISOString(),
          lastTriggeredAt: now.toISOString(),
          nextEvaluationAt: nextEvaluationFor(windowMinutes),
        })

        const delivered = await deliverAlert({
          teamId,
          channels: parseChannels(rule.channels),
          summary: {
            alertId: Number(alert.id),
            ruleName: String(rule.name),
            metric: String(rule.metric) as AlertMetric,
            severity,
            comparator: String(rule.comparator) as Comparator,
            observedValue: Number(result.value),
            thresholdValue: Number(rule.threshold),
            sampleSize: result.sampleSize,
            windowMinutes,
          },
        })

        await ReputationAlert.forceUpdate(alert.id, { notifiedChannels: JSON.stringify(delivered) })
        raised++
      }
      catch (error) {
        // One bad rule must not stop the rest of the tick.
        log.error(`[commshq:reputation] rule ${rule.id} evaluation failed: ${error instanceof Error ? error.message : String(error)}`)
        await ReputationAlertRule.forceUpdate(rule.id, {
          lastEvaluatedAt: now.toISOString(),
          nextEvaluationAt: nextEvaluationFor(windowMinutes),
        })
      }
    }

    return { evaluated: rules.length, raised }
  },
})
