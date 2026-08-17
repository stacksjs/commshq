import type { UsageQuotaStore } from '@stacksjs/newsletter'
import { db, sqlDateTime } from '@stacksjs/database'
import UsageMeter from '../../Models/UsageMeter'

export function updatedRows(result: unknown): number {
  const raw = (result as { numUpdatedRows?: unknown } | null | undefined)?.numUpdatedRows
  if (typeof raw === 'object' && raw !== null)
    return Number((raw as { changes?: number | bigint }).changes || 0)
  return Number(raw || 0)
}

export function usageMeterStore(input: {
  id: number
  teamId: number
  meter: string
}): UsageQuotaStore {
  return {
    async read(meter) {
      const now = new Date().toISOString()
      const current = await UsageMeter.where('id', input.id)
        .where('team_id', input.teamId)
        .where('key', input.meter)
        .where('periodStart', '<=', now)
        .where('periodEnd', '>', now)
        .first()
      if (!current || meter !== input.meter)
        return null

      return {
        meter,
        used: Number(current.quantity),
        limit: current.includedQuantity === null || current.includedQuantity === undefined
          ? null
          : Number(current.includedQuantity),
      }
    },

    async compareAndSet(snapshot, nextUsed) {
      let query = db
        .updateTable('usage_meters')
        .set({ quantity: nextUsed, updated_at: sqlDateTime() })
        .where('id', '=', input.id)
        .where('team_id', '=', input.teamId)
        .where('key', '=', input.meter)
        .where('quantity', '=', snapshot.used)
        .where('period_end', '>', new Date().toISOString())

      query = snapshot.limit === null
        ? query.whereNull('included_quantity')
        : query.where('included_quantity', '=', snapshot.limit)

      return updatedRows(await query.executeTakeFirst()) === 1
    },
  }
}
