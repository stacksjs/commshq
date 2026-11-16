/**
 * A workspace's allowance, month by month.
 *
 * `usage_meters` holds one row for a meter and a period, and the only thing
 * that ever wrote one was the owner seeder, for the month it ran in. Nothing
 * opened the next month. A send that asks for the open period then found none
 * and was refused, and a send that asked for the latest row kept counting
 * against a month long past, so an allowance that is "per month" was never
 * given back.
 *
 * `ensureOpenMeters` is the missing step, taken wherever a meter is about to
 * be read: a meter with no row covering now is given one for this calendar
 * month (UTC). What the workspace is allowed carries forward from its most
 * recent row, so a plan set once stays set. What it has used carries forward
 * only for the meters that count a stock (contacts held, domains added): a
 * month's emails, SMS segments and AI generations start again at nothing. A
 * workspace with no rows at all starts on the free plan.
 */

/** Run a statement written with `?` placeholders and answer its rows. See `sqlRun.ts`. */
export type MeterSqlRun = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

export const METER_KEYS = ['contacts', 'emails', 'sms_segments', 'ai_generations', 'custom_domains'] as const
export type MeterKey = typeof METER_KEYS[number]

/** What a workspace is allowed of each meter. `null` is no limit. */
export type MeterAllowances = Record<MeterKey, number | null>

/** Meters that count what a workspace holds, which a new month does not empty. */
const STOCK_METERS: ReadonlySet<MeterKey> = new Set<MeterKey>(['contacts', 'custom_domains'])

/** The plan limits a meter row is made from. The shape of `limits.<plan>` in config/saas.ts. */
export interface PlanMeterLimits {
  contacts: number | null
  emailsPerMonth: number | null
  customDomains: number | null
  aiGenerations: number | null
  sms: boolean
}

/** A plan's limits as meter allowances. A plan without SMS has an SMS allowance of nothing, not of no limit. */
export function meterAllowances(limits: PlanMeterLimits): MeterAllowances {
  return {
    contacts: limits.contacts,
    emails: limits.emailsPerMonth,
    sms_segments: limits.sms ? null : 0,
    ai_generations: limits.aiGenerations,
    custom_domains: limits.customDomains,
  }
}

let freePlan: MeterAllowances | undefined

/** The free plan's allowances, from config/saas.ts. */
export async function freeMeterAllowances(): Promise<MeterAllowances> {
  if (!freePlan) {
    const saas = (await import('../../config/saas')).default
    freePlan = meterAllowances(saas.limits.free)
  }
  return freePlan
}

/** The calendar month, in UTC, that holds a moment: its first instant and the next month's. */
export function monthOf(at: Date): { start: string, end: string } {
  return {
    start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString(),
    end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)).toISOString(),
  }
}

/** Teams already seen to have every meter open this month, by the function that runs their statements. */
const settled = new WeakMap<MeterSqlRun, Set<string>>()

export interface EnsureOpenMetersOptions {
  now?: Date
  /** What a workspace with no earlier row of a meter is allowed. Defaults to the free plan. */
  allowances?: MeterAllowances
}

/**
 * Make sure every meter of a team has a row covering now.
 *
 * Safe to call from two requests at once: a row is added only where the
 * unique index on team, meter and period start has none, so the second caller
 * adds nothing. Once a team's month is seen to be whole it costs nothing more
 * in this process.
 */
export async function ensureOpenMeters(run: MeterSqlRun, teamId: number, options: EnsureOpenMetersOptions = {}): Promise<void> {
  const at = options.now ?? new Date()
  const { start, end } = monthOf(at)
  const seen = settled.get(run) ?? new Set<string>()
  settled.set(run, seen)
  const mark = `${teamId}:${start}`
  if (seen.has(mark))
    return

  const moment = at.toISOString()
  const open = await run('SELECT key FROM usage_meters WHERE team_id = ? AND period_start <= ? AND period_end > ?', [teamId, moment, moment])
  const have = new Set(open.map(row => String(row.key)))
  const missing = METER_KEYS.filter(key => !have.has(key))

  if (missing.length > 0) {
    const allowances = options.allowances ?? await freeMeterAllowances()
    for (const key of missing) {
      const last = (await run('SELECT quantity, included_quantity FROM usage_meters WHERE team_id = ? AND key = ? ORDER BY period_start DESC LIMIT 1', [teamId, key]))[0]
      const included = last
        ? (last.included_quantity === null || last.included_quantity === undefined ? null : Number(last.included_quantity))
        : allowances[key]
      const quantity = last && STOCK_METERS.has(key) ? Number(last.quantity || 0) : 0
      await run(
        'INSERT INTO usage_meters (uuid, team_id, key, quantity, included_quantity, period_start, period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (team_id, key, period_start) DO NOTHING',
        [crypto.randomUUID(), teamId, key, quantity, included, start, end, moment, moment],
      )
    }
  }

  seen.add(mark)
}

/** `ensureOpenMeters` on this app's own database. */
export async function ensureOpenMetersNow(teamId: number): Promise<void> {
  const { sqlRun } = await import('./sqlRun')
  await ensureOpenMeters(sqlRun, teamId)
}
