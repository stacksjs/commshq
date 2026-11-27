import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { isUniqueViolation } from '@stacksjs/orm'
import AuditEvent from '../../../../Models/AuditEvent'
import { activeTeam } from '../../../../Support/activeTeam'
import { canRecordEarnings, reversalAmounts, reversalSource, reversedIdOf } from '../../../../Support/earnings'

const COLUMNS = ['id', 'team_id', 'source_type', 'source_id', 'gross_amount', 'fee_amount', 'net_amount', 'currency', 'occurred_at', 'created_at'] as const

type EarningRow = Record<(typeof COLUMNS)[number], any>

/** The entry as the ledger's list returns it, without the workspace it belongs to. */
function shown(row: EarningRow) {
  return {
    id: Number(row.id),
    source_type: row.source_type,
    source_id: row.source_id,
    gross_amount: Number(row.gross_amount),
    fee_amount: Number(row.fee_amount),
    net_amount: Number(row.net_amount),
    currency: row.currency,
    occurred_at: row.occurred_at,
    created_at: row.created_at,
  }
}

/**
 * Cancel a ledger entry that was recorded wrong.
 *
 * The entry stays. A reversal is added beside it with every amount negated,
 * dated now, so the two sum to nothing and the record shows both. Reversing
 * the same entry again returns the reversal already made. A reversal cannot
 * itself be reversed.
 */
export default new Action({
  name: 'Reverse Earning',
  description: 'Cancels a workspace earnings ledger entry by adding a reversal with the amounts negated',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canRecordEarnings(membership?.role)) return response.json({ error: 'Reversing earnings requires an admin or owner role' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'Earning id must be a positive integer' }, 422)

    const entry = await db.selectFrom('earnings' as any)
      .select(COLUMNS as any)
      .where('id' as any, '=', id)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst() as EarningRow | undefined
    if (!entry) return response.json({ error: 'Earning not found' }, 404)
    if (reversedIdOf(entry.source_id)) return response.json({ error: 'A reversal cannot be reversed; record the payment again instead' }, 409)

    const sourceId = reversalSource(id)
    const amounts = reversalAmounts(entry)
    const now = new Date().toISOString()

    try {
      const created = await db.insertInto('earnings' as any).values({
        team_id: teamId,
        uuid: crypto.randomUUID(),
        source_type: entry.source_type,
        source_id: sourceId,
        ...amounts,
        currency: entry.currency,
        occurred_at: now,
        ad_placement_id: null,
        created_at: now,
        updated_at: now,
      } as any).returning(COLUMNS as any).executeTakeFirstOrThrow() as EarningRow

      await AuditEvent.forceCreate({
        team_id: teamId,
        user_id: Number(user.id),
        action: 'earning.reversed',
        subjectType: 'Earning',
        subjectId: String(created.id),
        metadata: JSON.stringify({ reverses: id, source_type: entry.source_type, net_amount: amounts.net_amount, currency: entry.currency }),
        occurredAt: now,
      })

      return response.json({ data: shown(created) }, 201)
    }
    catch (caught) {
      if (!isUniqueViolation(caught))
        throw caught
      // Already reversed. The entry is this workspace's, checked above, so
      // its reversal is too.
      const existing = await db.selectFrom('earnings' as any)
        .select(COLUMNS as any)
        .where('source_type' as any, '=', entry.source_type)
        .where('source_id' as any, '=', sourceId)
        .executeTakeFirst() as EarningRow | undefined
      if (!existing || Number(existing.team_id) !== teamId)
        return response.json({ error: 'This entry could not be reversed' }, 409)
      return response.json({ data: shown(existing), replayed: true })
    }
  },
})
