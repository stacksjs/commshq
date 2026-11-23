import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { isUniqueViolation } from '@stacksjs/orm'
import AuditEvent from '../../../../Models/AuditEvent'
import { activeTeam } from '../../../../Support/activeTeam'
import { canRecordEarnings, EARNING_CURRENCY, readSponsorPayment, sponsorPaymentSource } from '../../../../Support/earnings'

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
 * Record a payment from one of the workspace's sponsors in the earnings
 * ledger.
 *
 * `Earning` publishes only a read-only API, and its columns are not
 * fillable, so this is the one way an entry is written. The sponsor comes
 * from the path and must belong to the caller's workspace; the amounts, the
 * day and the form's key come from the body; everything else is decided
 * here. Sending the same key again returns the entry already recorded.
 */
export default new Action({
  name: 'Record Sponsor Payment',
  description: 'Adds a payment received from a sponsor to the workspace earnings ledger',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canRecordEarnings(membership?.role)) return response.json({ error: 'Recording earnings requires an admin or owner role' }, 403)

    const sponsorId = Number(request.getParam('id'))
    if (!Number.isSafeInteger(sponsorId) || sponsorId < 1) return response.json({ error: 'Sponsor id must be a positive integer' }, 422)

    const sponsor = await db.selectFrom('sponsors' as any)
      .select(['id', 'name'] as any)
      .where('id' as any, '=', sponsorId)
      .where('team_id' as any, '=', teamId)
      .executeTakeFirst() as { id: number, name: string } | undefined
    if (!sponsor) return response.json({ error: 'Sponsor not found' }, 404)

    const today = new Date().toISOString().slice(0, 10)
    const { payment, error } = readSponsorPayment({
      gross_amount: request.get('gross_amount'),
      fee_amount: request.get('fee_amount'),
      occurred_on: request.get('occurred_on'),
      key: request.get('key'),
    }, today)
    if (!payment) return response.json({ error }, 422)

    const sourceId = sponsorPaymentSource(sponsorId, payment.key)
    const now = new Date().toISOString()

    try {
      const created = await db.insertInto('earnings' as any).values({
        team_id: teamId,
        uuid: crypto.randomUUID(),
        source_type: 'sponsorship',
        source_id: sourceId,
        gross_amount: payment.grossAmount,
        fee_amount: payment.feeAmount,
        net_amount: payment.netAmount,
        currency: EARNING_CURRENCY,
        occurred_at: payment.occurredAt,
        ad_placement_id: null,
        created_at: now,
        updated_at: now,
      } as any).returning(COLUMNS as any).executeTakeFirstOrThrow() as EarningRow

      await AuditEvent.forceCreate({
        team_id: teamId,
        user_id: Number(user.id),
        action: 'earning.recorded',
        subjectType: 'Earning',
        subjectId: String(created.id),
        metadata: JSON.stringify({ source_type: 'sponsorship', sponsor_id: sponsorId, gross_amount: payment.grossAmount, fee_amount: payment.feeAmount, currency: EARNING_CURRENCY, occurred_at: payment.occurredAt }),
        occurredAt: now,
      })

      return response.json({ data: shown(created) }, 201)
    }
    catch (caught) {
      if (!isUniqueViolation(caught))
        throw caught
      // The same key again: the entry already recorded is the answer, as long
      // as it is this workspace's. A key is a UUID the form made, so another
      // workspace holding it means the request was not a retry.
      const existing = await db.selectFrom('earnings' as any)
        .select(COLUMNS as any)
        .where('source_type' as any, '=', 'sponsorship')
        .where('source_id' as any, '=', sourceId)
        .executeTakeFirst() as EarningRow | undefined
      if (!existing || Number(existing.team_id) !== teamId)
        return response.json({ error: 'This payment key is already in use' }, 409)
      return response.json({ data: shown(existing), replayed: true })
    }
  },
})
