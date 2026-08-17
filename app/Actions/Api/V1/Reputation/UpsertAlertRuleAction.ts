import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { isUniqueViolation } from '@stacksjs/orm'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../../Models/AuditEvent'
import ReputationAlertRule from '../../../../Models/ReputationAlertRule'
import { ALERT_CHANNELS } from '../../../Reputation/notify-alert'
import { parsePlatform } from '../../../Reputation/platforms'
import { canManageReputation } from '../../../Reputation/policy'
import { parseComparator, parseMetric } from '../../../Reputation/thresholds'
import { activeTeamId } from '../team'

const SEVERITIES = ['info', 'warning', 'critical']

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null
  return parsed
}

export default new Action({
  name: 'Upsert Reputation Alert Rule',
  description: 'Creates or updates a threshold rule that raises reputation alerts',
  method: 'POST',

  async handle(request: RequestInstance) {
    const teamId = await activeTeamId(request)
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageReputation((user as any).team_role)) return response.json({ error: 'Alert rules require an admin or owner role' }, 403)

    const name = String(request.get('name') || '').trim()
    if (!name || name.length > 120) return response.json({ error: 'name is required and must be 120 characters or fewer' }, 422)

    const metric = parseMetric(request.get('metric'))
    const comparator = parseComparator(request.get('comparator'))
    if (!metric) return response.json({ error: 'Unsupported metric' }, 422)
    if (!comparator) return response.json({ error: 'comparator must be gte or lte' }, 422)

    const threshold = Number(request.get('threshold'))
    if (!Number.isFinite(threshold)) return response.json({ error: 'threshold must be a number' }, 422)
    if (metric === 'average_rating' && (threshold < 1 || threshold > 5))
      return response.json({ error: 'threshold for average_rating must be between 1 and 5' }, 422)

    const windowMinutes = boundedInteger(request.get('windowMinutes'), 1_440, 15, 43_200)
    const minimumSampleSize = boundedInteger(request.get('minimumSampleSize'), 1, 1, 10_000)
    const cooldownMinutes = boundedInteger(request.get('cooldownMinutes'), 360, 15, 43_200)
    if (windowMinutes === null) return response.json({ error: 'windowMinutes must be an integer between 15 and 43200' }, 422)
    if (minimumSampleSize === null) return response.json({ error: 'minimumSampleSize must be an integer between 1 and 10000' }, 422)
    if (cooldownMinutes === null) return response.json({ error: 'cooldownMinutes must be an integer between 15 and 43200' }, 422)

    const severity = String(request.get('severity') || 'warning').toLowerCase()
    if (!SEVERITIES.includes(severity)) return response.json({ error: 'severity must be info, warning, or critical' }, 422)

    const rawPlatforms = request.get('platforms')
    const platformList = Array.isArray(rawPlatforms) ? rawPlatforms : []
    const platforms: string[] = []
    for (const entry of platformList) {
      const platform = parsePlatform(entry)
      if (!platform) return response.json({ error: `Unsupported platform: ${String(entry)}` }, 422)
      platforms.push(platform)
    }

    const rawChannels = request.get('channels')
    const channelList = Array.isArray(rawChannels) && rawChannels.length ? rawChannels : ['database', 'email']
    const channels: string[] = []
    for (const entry of channelList) {
      const channel = String(entry).toLowerCase()
      if (!(ALERT_CHANNELS as readonly string[]).includes(channel)) return response.json({ error: `Unsupported channel: ${String(entry)}` }, 422)
      channels.push(channel)
    }

    const fields = {
      metric,
      comparator,
      threshold,
      windowMinutes,
      minimumSampleSize,
      platforms: JSON.stringify(platforms),
      severity,
      channels: JSON.stringify(channels),
      cooldownMinutes,
      status: String(request.get('status') || 'active').toLowerCase() === 'paused' ? 'paused' : 'active',
    }

    // Rule names are unique per team, which makes the name the natural upsert key.
    const existing = await ReputationAlertRule.where('team_id', teamId).where('name', name).first()
    if (existing) {
      await ReputationAlertRule.forceUpdate(existing.id, { ...fields, nextEvaluationAt: new Date().toISOString() })
      await AuditEvent.forceCreate({
        team_id: teamId,
        user_id: Number(user.id),
        action: 'reputation_alert_rule.updated',
        subjectType: 'ReputationAlertRule',
        subjectId: String(existing.id),
        metadata: JSON.stringify(fields),
        occurredAt: new Date().toISOString(),
      })
      return response.json({ data: await ReputationAlertRule.where('id', existing.id).where('team_id', teamId).first() })
    }

    try {
      const rule = await ReputationAlertRule.forceCreate({
        team_id: teamId,
        name,
        ...fields,
        nextEvaluationAt: new Date().toISOString(),
      })

      await AuditEvent.forceCreate({
        team_id: teamId,
        user_id: Number(user.id),
        action: 'reputation_alert_rule.created',
        subjectType: 'ReputationAlertRule',
        subjectId: String(rule.id),
        metadata: JSON.stringify(fields),
        occurredAt: new Date().toISOString(),
      })

      return response.json({ data: rule }, 201)
    }
    catch (error) {
      if (isUniqueViolation(error))
        return response.json({ error: 'A rule with this name already exists' }, 409)
      throw error
    }
  },
})
