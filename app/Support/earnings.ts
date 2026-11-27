/**
 * Recording a sponsor's payment in the earnings ledger.
 *
 * `Earning` is the ledger the command center sums and the monetization page
 * lists, and until now nothing wrote to it. A sponsor paying for a placement
 * is the income a workspace can already name: the sponsor is on record, and
 * the person who was paid knows the amount, the fees and the day. So that is
 * the first thing recorded, typed in by an owner or admin.
 *
 * The ledger is append-only, as the model's non-fillable columns say: there
 * is no edit and no delete. That is what lets a total be trusted later.
 *
 * Amounts are minor units, as everywhere else, and in US dollars only for
 * now: the command center adds the newest entries together into one figure,
 * and adding euros to dollars would make that figure wrong.
 */

export const EARNING_CURRENCY = 'USD'
/** $10,000,000 in cents: far past any one sponsor payment, short of a typo with extra zeros. */
export const MAX_PAYMENT_MINOR = 1_000_000_000
/** Payments older than this are bookkeeping for another tool, not this ledger. */
export const EARLIEST_PAYMENT_DATE = '2000-01-01'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface SponsorPayment {
  grossAmount: number
  feeAmount: number
  netAmount: number
  /** Noon UTC on the day received, so the day reads the same in every timezone a member is in. */
  occurredAt: string
  /** The form's own key, so a double click or a retried request records one payment, not two. */
  key: string
}

/** Recording income changes what the whole workspace reports. */
export function canRecordEarnings(role: unknown): boolean {
  return ['owner', 'admin'].includes(String(role || '').toLowerCase())
}

function minorUnits(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) ? number : null
}

/** A calendar date as given, or null when it is not a real one. */
function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value))
    return null
  const date = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

/**
 * Read a payment from a request body, or say what is wrong with it.
 *
 * `today` is the server's date in UTC. A member a day ahead of UTC may
 * record a payment dated their today, so one day past it is allowed.
 */
export function readSponsorPayment(body: Record<string, unknown>, today: string): { payment: SponsorPayment | null, error: string } {
  const fail = (error: string) => ({ payment: null, error })

  const gross = minorUnits(body.gross_amount)
  if (gross === null || gross < 1)
    return fail('gross_amount must be a whole number of cents above zero')
  if (gross > MAX_PAYMENT_MINOR)
    return fail('gross_amount is more than one payment can be')

  const fee = body.fee_amount === undefined || body.fee_amount === null || body.fee_amount === '' ? 0 : minorUnits(body.fee_amount)
  if (fee === null || fee < 0)
    return fail('fee_amount must be a whole number of cents, zero or more')
  if (fee > gross)
    return fail('fee_amount cannot be more than the payment')

  const day = calendarDate(body.occurred_on)
  if (!day)
    return fail('occurred_on must be a date such as 2026-11-23')
  if (day < EARLIEST_PAYMENT_DATE)
    return fail(`occurred_on cannot be before ${EARLIEST_PAYMENT_DATE}`)
  const latest = new Date(`${today}T12:00:00.000Z`)
  latest.setUTCDate(latest.getUTCDate() + 1)
  if (day > latest.toISOString().slice(0, 10))
    return fail('occurred_on cannot be in the future')

  const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : ''
  if (!UUID.test(key))
    return fail('key must be a UUID')

  return {
    payment: { grossAmount: gross, feeAmount: fee, netAmount: gross - fee, occurredAt: `${day}T12:00:00.000Z`, key },
    error: '',
  }
}

/**
 * The ledger's `source_id` for a sponsor payment. The unique index on the
 * source is what turns a repeated request into the same entry.
 */
export function sponsorPaymentSource(sponsorId: number, key: string): string {
  return `sponsor:${Math.trunc(sponsorId)}:${key}`
}

/**
 * Correcting an entry.
 *
 * Nothing in the ledger is edited or deleted. A wrong entry is cancelled by
 * a reversal: a second entry of the same kind with every amount negated, so
 * the two sum to nothing and both stay on record. The right figure is then
 * recorded as a new payment.
 *
 * A reversal's source is `reversal:{id}` of the entry it cancels, and the
 * unique index on the source means an entry can be reversed once. A
 * reversal is never itself reversed: recording the payment again is how
 * that is undone.
 */
const REVERSAL = /^reversal:(\d+)$/

export function reversalSource(earningId: number): string {
  return `reversal:${Math.trunc(earningId)}`
}

/** The entry a reversal cancels, or 0 when the source is not a reversal. */
export function reversedIdOf(sourceId: unknown): number {
  const match = REVERSAL.exec(String(sourceId ?? ''))
  return match ? Number(match[1]) : 0
}

export interface LedgerAmounts {
  gross_amount: number
  fee_amount: number
  net_amount: number
}

/** The amounts that cancel an entry: each one negated. */
export function reversalAmounts(entry: LedgerAmounts): LedgerAmounts {
  const negate = (value: number) => (Number(value) === 0 ? 0 : -Number(value))
  return { gross_amount: negate(entry.gross_amount), fee_amount: negate(entry.fee_amount), net_amount: negate(entry.net_amount) }
}
