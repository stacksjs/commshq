import { db } from '@stacksjs/database'

/**
 * What a workspace did over a period, counted from its own tables.
 *
 * The analytics page used to state "68.4% known visitors", "71.2% 30-day
 * retention" and "$48.20 reader LTV" for every account. Nothing in the
 * application records a visit, an open, a click or an attributed sale, so
 * none of those numbers could come from anywhere.
 *
 * This counts the four things the application does write:
 *
 * - `contacts`, when someone is added
 * - `form_submissions`, when a signup form is posted to
 * - `consent_events`, when someone opts in or out
 * - `campaign_recipients`, when a campaign is sent, with how each ended
 *
 * Counts only. No address, name or payload leaves this module, so every
 * member of the workspace may read it.
 */
export const ANALYTICS_PERIODS = [7, 30, 90] as const
export const DEFAULT_PERIOD = 30

export type AnalyticsPeriod = typeof ANALYTICS_PERIODS[number]

/** How many campaigns and forms are listed. The rest are still in the totals. */
export const ANALYTICS_LIST_LIMIT = 8

/** The outcomes a recipient row can hold, as `DispatchCampaign` writes them. */
export const RECIPIENT_STATUSES = ['queued', 'sent', 'delivered', 'failed', 'suppressed', 'cancelled'] as const

/** The period asked for, or the default when it is not one of the offered ones. */
export function analyticsPeriod(value: unknown): AnalyticsPeriod {
  const days = Number(value)
  return (ANALYTICS_PERIODS as readonly number[]).includes(days) ? days as AnalyticsPeriod : DEFAULT_PERIOD
}

/**
 * The first instant of the period: midnight UTC, `days - 1` days before
 * today, so a 7-day period is today and the six days before it.
 */
export function periodStart(days: number, now: Date = new Date()): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return start.toISOString()
}

interface CountRow { key: unknown, n: unknown }

/** `count(*)` of the team's rows in `table` since `since`, grouped by `expression`. */
async function grouped(table: string, teamId: number, expression: string, timeColumn: string | null, since: string): Promise<Array<{ key: string, count: number }>> {
  let query = (db as any).selectFrom(table).selectRaw(`${expression} as key, count(*) as n`).where('team_id', '=', teamId)
  if (timeColumn) query = query.where(timeColumn, '>=', since)
  const rows = await query.groupBy('key').execute() as CountRow[]
  return rows.map(row => ({ key: String(row.key ?? ''), count: Number(row.n) || 0 }))
}

async function names(table: string, teamId: number, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map()
  const rows = await (db as any).selectFrom(table).select(['id', 'name']).where('team_id', '=', teamId).where('id', 'in', ids).execute() as Array<{ id: number, name: string }>
  return new Map(rows.map(row => [Number(row.id), String(row.name ?? '')]))
}

function total(rows: Array<{ count: number }>): number {
  return rows.reduce((sum, row) => sum + row.count, 0)
}

export async function workspaceAnalytics(teamId: number, days: AnalyticsPeriod, now: Date = new Date()) {
  const since = periodStart(days, now)

  const [contactStatuses, contactDays, submissionForms, consentActions, recipientRows] = await Promise.all([
    // Every contact, not only the period's: this is who is in the workspace now.
    grouped('contacts', teamId, 'status', null, since),
    // The stored timestamp is ISO 8601 in UTC, so its first ten characters are the day.
    grouped('contacts', teamId, 'substr(created_at, 1, 10)', 'created_at', since),
    grouped('form_submissions', teamId, 'form_definition_id', 'created_at', since),
    grouped('consent_events', teamId, 'action', 'occurred_at', since),
    (db as any).selectFrom('campaign_recipients').selectRaw('campaign_id, status, count(*) as n').where('team_id', '=', teamId).where('created_at', '>=', since).groupBy('campaign_id').groupBy('status').execute() as Promise<Array<{ campaign_id: number, status: string, n: number }>>,
  ])

  const byCampaign = new Map<number, Record<string, number>>()
  const outcomes: Record<string, number> = Object.fromEntries(RECIPIENT_STATUSES.map(status => [status, 0]))
  for (const row of recipientRows) {
    const id = Number(row.campaign_id)
    const count = Number(row.n) || 0
    const status = String(row.status)
    const counts = byCampaign.get(id) ?? {}
    counts[status] = (counts[status] ?? 0) + count
    byCampaign.set(id, counts)
    outcomes[status] = (outcomes[status] ?? 0) + count
  }

  const campaignIds = [...byCampaign.keys()].sort((a, b) => b - a).slice(0, ANALYTICS_LIST_LIMIT)
  const forms = submissionForms
    .map(row => ({ id: Number(row.key), count: row.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, ANALYTICS_LIST_LIMIT)

  const [campaignNames, formNames] = await Promise.all([
    names('campaigns', teamId, campaignIds),
    names('form_definitions', teamId, forms.map(form => form.id)),
  ])

  return {
    days,
    since,
    until: now.toISOString(),
    contacts: {
      total: total(contactStatuses),
      added: total(contactDays),
      byStatus: contactStatuses.map(row => ({ status: row.key, count: row.count })),
      byDay: contactDays.map(row => ({ day: row.key, count: row.count })).sort((a, b) => a.day.localeCompare(b.day)),
    },
    signups: {
      total: total(submissionForms),
      byForm: forms.map(form => ({ id: form.id, name: formNames.get(form.id) ?? null, count: form.count })),
    },
    consent: {
      byAction: consentActions.map(row => ({ action: row.key, count: row.count })),
    },
    sending: {
      recipients: Object.values(outcomes).reduce((sum, count) => sum + count, 0),
      outcomes,
      campaigns: campaignIds.map(id => ({ id, name: campaignNames.get(id) ?? null, outcomes: byCampaign.get(id) ?? {} })),
      campaignCount: byCampaign.size,
    },
  }
}
