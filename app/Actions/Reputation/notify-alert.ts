import type { AlertMetric, Severity } from './thresholds'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { notify } from '@stacksjs/notifications'

/** Channels a rule may fan an alert out to, intersected with what notify() supports. */
export const ALERT_CHANNELS = ['database', 'email', 'sms', 'chat'] as const
export type AlertChannel = typeof ALERT_CHANNELS[number]

/** Only owners and admins are paged; members and viewers read alerts in the dashboard. */
const NOTIFIED_ROLES = ['owner', 'admin']

export function parseChannels(value: unknown): AlertChannel[] {
  const raw = typeof value === 'string' ? safeParse(value) : value
  if (!Array.isArray(raw)) return ['database']
  const channels = raw
    .map(entry => String(entry).toLowerCase())
    .filter((entry): entry is AlertChannel => (ALERT_CHANNELS as readonly string[]).includes(entry))
  // Always keep the in-app record even if a rule only names external channels,
  // so an alert is never invisible when an external transport is down.
  return channels.includes('database') ? channels : ['database', ...channels]
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}

export interface AlertRecipient {
  userId: number
  email: string | null
  role: string
}

export async function alertRecipients(teamId: number): Promise<AlertRecipient[]> {
  const rows = await db
    .selectFrom('team_members' as any)
    .innerJoin('users' as any, 'users.id' as any, '=' as any, 'team_members.user_id' as any)
    .select(['team_members.user_id as user_id', 'team_members.role as role', 'users.email as email'] as any)
    .where('team_members.team_id' as any, '=', teamId)
    .where('team_members.status' as any, '=', 'active')
    .where('team_members.role' as any, 'in', NOTIFIED_ROLES)
    .execute() as Array<{ user_id: number, role: string, email: string | null }>

  return rows.map(row => ({ userId: Number(row.user_id), email: row.email || null, role: String(row.role) }))
}

const METRIC_LABELS: Record<AlertMetric, string> = {
  negative_mention_count: 'Negative mentions',
  mention_volume: 'Mention volume',
  average_rating: 'Average rating',
  average_sentiment: 'Average sentiment',
  unanswered_negative_count: 'Unanswered negative mentions',
}

/** Ratings read as one decimal; counts are whole numbers. */
function formatValue(metric: AlertMetric, value: number): string {
  if (metric === 'average_rating') return value.toFixed(1)
  if (metric === 'average_sentiment') return String(Math.round(value))
  return String(Math.round(value))
}

export interface AlertSummary {
  ruleName: string
  metric: AlertMetric
  severity: Severity
  comparator: 'gte' | 'lte'
  observedValue: number
  thresholdValue: number
  sampleSize: number
  windowMinutes: number
  alertId: number
}

export function alertSubject(summary: AlertSummary): string {
  return `[${summary.severity}] ${summary.ruleName}`
}

export function alertBody(summary: AlertSummary): string {
  const direction = summary.comparator === 'gte' ? 'at or above' : 'at or below'
  const hours = summary.windowMinutes / 60
  const window = hours >= 1 ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour` : `${summary.windowMinutes} minute`

  return [
    `${METRIC_LABELS[summary.metric]} is ${direction} the alert threshold.`,
    `Observed: ${formatValue(summary.metric, summary.observedValue)} (threshold ${formatValue(summary.metric, summary.thresholdValue)}).`,
    `Measured across ${summary.sampleSize} mention${summary.sampleSize === 1 ? '' : 's'} in the last ${window} window.`,
    `Review it at /dashboard/commshq/reputation?alert=${summary.alertId}`,
  ].join('\n')
}

/**
 * Fan an alert out to the workspace owners and admins.
 *
 * Delivery is best effort per recipient: a bounced address or an SMS failure
 * must not stop the remaining recipients from being told, and must not fail the
 * evaluation job that raised the alert.
 */
export async function deliverAlert(input: {
  teamId: number
  channels: AlertChannel[]
  summary: AlertSummary
}): Promise<AlertChannel[]> {
  const recipients = await alertRecipients(input.teamId)
  if (!recipients.length) return []

  const subject = alertSubject(input.summary)
  const body = alertBody(input.summary)
  const delivered = new Set<AlertChannel>()

  for (const recipient of recipients) {
    // Drop channels this recipient cannot receive on rather than handing
    // notify() a recipient with no address for the transport.
    const channels = input.channels.filter(channel => channel !== 'email' || recipient.email)
    if (!channels.length) continue

    try {
      const results = await notify(
        { userId: recipient.userId, email: recipient.email ?? undefined },
        { subject, body, data: { ...input.summary, teamId: input.teamId } },
        channels,
        { category: 'reputation_alert' },
      )
      for (const result of results)
        if (result.success) delivered.add(result.channel as AlertChannel)
    }
    catch (error) {
      log.error(`[commshq:reputation] alert ${input.summary.alertId} delivery to user ${recipient.userId} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return [...delivered]
}
