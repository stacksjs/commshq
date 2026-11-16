import { db, sql } from '@stacksjs/database'
import { ATTRIBUTION_WINDOW_DAYS } from './commerceAttribution'

/**
 * What a workspace did over a period, counted from its own tables.
 *
 * The analytics page used to state "68.4% known visitors", "71.2% 30-day
 * retention" and "$48.20 reader LTV" for every account. Nothing in the
 * application records a visit, an open, a click or an attributed sale, so
 * none of those numbers could come from anywhere.
 *
 * This counts what the application does write:
 *
 * - `contacts`, when someone is added
 * - `form_submissions`, when a signup form is posted to
 * - `consent_events`, when someone opts in or out
 * - `campaign_recipients`, when a campaign is sent, with how each ended
 * - `commerce_events`, the orders and refunds a connected store sends
 * - `attribution_events`, the orders credited to a campaign or automation
 *   email (`commerceAttribution`)
 *
 * Money is summed per currency, never across currencies: a store can sell
 * in more than one, and a total of dollars and euros means nothing.
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

/*
 * Grouped counts name the grouped column in `select` and pass only the
 * aggregate through `selectRaw`. Given `selectRaw` alone, the builder writes
 * `SELECT *, ...`, which SQLite runs and Postgres, where production lives,
 * refuses beside a GROUP BY. Aggregates come back as strings from Postgres,
 * hence the `Number()` on every one.
 */

/** `count(*)` of the team's rows in `table` since `since`, grouped by `column`. */
async function grouped(table: string, teamId: number, column: string, timeColumn: string | null, since: string): Promise<Array<{ key: string, count: number }>> {
  let query = (db as any).selectFrom(table).select([`${column} as key`]).selectRaw(sql`count(*) as n`).where('team_id', '=', teamId)
  if (timeColumn) query = query.where(timeColumn, '>=', since)
  const rows = await query.groupBy(column).execute() as CountRow[]
  return rows.map(row => ({ key: String(row.key ?? ''), count: Number(row.n) || 0 }))
}

/**
 * Contacts added per UTC day since `since`. Bucketed here rather than in
 * SQL: taking the day from a timestamp is spelled differently in every
 * database, and the column is text in SQLite and a timestamp in Postgres.
 */
async function contactsPerDay(teamId: number, since: string): Promise<Array<{ key: string, count: number }>> {
  const rows = await (db as any).selectFrom('contacts').select(['created_at']).where('team_id', '=', teamId).where('created_at', '>=', since).execute() as Array<{ created_at: unknown }>
  const days = new Map<string, number>()
  for (const row of rows) {
    const date = new Date(row.created_at as string)
    if (Number.isNaN(date.getTime()))
      continue
    const day = date.toISOString().slice(0, 10)
    days.set(day, (days.get(day) ?? 0) + 1)
  }
  return [...days].map(([key, count]) => ({ key, count }))
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
    contactsPerDay(teamId, since),
    grouped('form_submissions', teamId, 'form_definition_id', 'created_at', since),
    grouped('consent_events', teamId, 'action', 'occurred_at', since),
    (db as any).selectFrom('campaign_recipients').select(['campaign_id', 'status']).selectRaw(sql`count(*) as n`).where('team_id', '=', teamId).where('created_at', '>=', since).groupBy('campaign_id').groupBy('status').execute() as Promise<Array<{ campaign_id: number, status: string, n: number }>>,
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

  const commerce = await commerceAnalytics(teamId, since)

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
    commerce,
  }
}

interface MoneyRow { currency: string, amount: number, count: number }

function money(rows: Array<{ currency: unknown, total: unknown, n: unknown }>): MoneyRow[] {
  return rows
    .map(row => ({ currency: String(row.currency || 'USD').toUpperCase(), amount: Number(row.total) || 0, count: Number(row.n) || 0 }))
    .sort((a, b) => b.amount - a.amount)
}

/** Orders, refunds and credited revenue since `since`, each per currency. */
async function commerceAnalytics(teamId: number, since: string) {
  const byType = (type: string) => (db as any).selectFrom('commerce_events')
    .select(['currency']).selectRaw(sql`sum(amount) as total, count(*) as n`)
    .where('team_id', '=', teamId).where('type', '=', type).where('occurred_at', '>=', since)
    .groupBy('currency').execute() as Promise<Array<{ currency: string, total: number, n: number }>>

  const [orders, refunds, matched, credited] = await Promise.all([
    byType('order_created'),
    byType('order_refunded'),
    (db as any).selectFrom('commerce_events').where('team_id', '=', teamId).where('type', '=', 'order_created')
      .where('occurred_at', '>=', since).where('contact_id', 'is not', null).count() as Promise<number>,
    (db as any).selectFrom('attribution_events')
      .select(['source', 'campaign_key', 'currency']).selectRaw(sql`sum(revenue) as total, count(*) as n`)
      .where('team_id', '=', teamId).where('kind', '=', 'purchase').where('occurred_at', '>=', since)
      .groupBy('source').groupBy('campaign_key').groupBy('currency').execute() as Promise<Array<{ source: string, campaign_key: string, currency: string, total: number, n: number }>>,
  ])

  // Name each credited campaign or automation, scoped to this team.
  const ids = (source: string) => [...new Set(credited.filter(row => row.source === source).map(row => Number(String(row.campaign_key).split(':')[1])).filter(id => id > 0))]
  const [campaignNames, automationNames] = await Promise.all([names('campaigns', teamId, ids('campaign')), names('automations', teamId, ids('automation'))])

  const sources = new Map<string, { source: string, id: number, name: string | null, orders: number, revenue: MoneyRow[] }>()
  for (const row of credited) {
    const id = Number(String(row.campaign_key).split(':')[1]) || 0
    const key = `${row.source}:${id}`
    const entry = sources.get(key) ?? { source: String(row.source), id, name: (row.source === 'automation' ? automationNames : campaignNames).get(id) ?? null, orders: 0, revenue: [] }
    entry.orders += Number(row.n) || 0
    entry.revenue.push(...money([{ currency: row.currency, total: row.total, n: row.n }]))
    sources.set(key, entry)
  }
  const orderCount = orders.reduce((sum, row) => sum + (Number(row.n) || 0), 0)

  return {
    orders: { count: orderCount, revenue: money(orders), fromContacts: Number(matched) || 0 },
    refunds: { count: refunds.reduce((sum, row) => sum + (Number(row.n) || 0), 0), amount: money(refunds) },
    credited: {
      orders: credited.reduce((sum, row) => sum + (Number(row.n) || 0), 0),
      revenue: money(Object.values(credited.reduce((acc, row) => {
        const currency = String(row.currency || 'USD').toUpperCase()
        acc[currency] ??= { currency, total: 0, n: 0 }
        acc[currency].total += Number(row.total) || 0
        acc[currency].n += Number(row.n) || 0
        return acc
      }, {} as Record<string, { currency: string, total: number, n: number }>))),
      bySource: [...sources.values()].sort((a, b) => b.orders - a.orders).slice(0, ANALYTICS_LIST_LIMIT),
    },
    windowDays: ATTRIBUTION_WINDOW_DAYS,
  }
}
