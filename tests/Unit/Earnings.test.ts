/**
 * Recording a sponsor's payment in the earnings ledger.
 *
 * The ledger is append-only, so what goes in has to be right the first
 * time: whole cents, fees no larger than the payment, a real day that has
 * happened, and a key that makes a retried request the same entry rather
 * than a second one.
 */
import { describe, expect, test } from 'bun:test'
import { canRecordEarnings, EARNING_CURRENCY, MAX_PAYMENT_MINOR, readSponsorPayment, reversalAmounts, reversalSource, reversedIdOf, sponsorPaymentSource } from '../../app/Support/earnings'
import { MAX_PAYMENT_MINOR as PAGE_MAX, reversedIdOf as pageReversedIdOf } from '../../resources/data/monetization-query'

const today = '2026-11-23'
const key = '8b1f0c2e-1d3a-4c5b-9e6f-0a1b2c3d4e5f'
const body = { gross_amount: 125000, fee_amount: 3625, occurred_on: '2026-11-20', key }

describe('who may record', () => {
  test('owners and admins only', () => {
    expect(canRecordEarnings('owner')).toBe(true)
    expect(canRecordEarnings('Admin')).toBe(true)
    for (const role of ['member', 'viewer', '', null, undefined])
      expect(canRecordEarnings(role)).toBe(false)
  })
})

describe('reading a payment', () => {
  test('a good payment is read into cents, net of fees, at noon UTC', () => {
    expect(readSponsorPayment(body, today)).toEqual({
      payment: { grossAmount: 125000, feeAmount: 3625, netAmount: 121375, occurredAt: '2026-11-20T12:00:00.000Z', key },
      error: '',
    })
  })

  test('fees are optional, and a key is read case-blind', () => {
    const { payment } = readSponsorPayment({ ...body, fee_amount: undefined, key: key.toUpperCase() }, today)
    expect(payment).toMatchObject({ feeAmount: 0, netAmount: 125000, key })
    expect(readSponsorPayment({ ...body, gross_amount: '500', fee_amount: '' }, today).payment).toMatchObject({ grossAmount: 500, feeAmount: 0 })
  })

  test('the amount is whole cents above zero, within one payment', () => {
    for (const gross_amount of [0, -1, 12.5, '12.50', 'abc', null, undefined, Number.MAX_SAFE_INTEGER + 1])
      expect(readSponsorPayment({ ...body, gross_amount }, today).error).toContain('gross_amount')
    expect(readSponsorPayment({ ...body, gross_amount: MAX_PAYMENT_MINOR + 1 }, today).error).toContain('more than one payment')
    expect(readSponsorPayment({ ...body, gross_amount: MAX_PAYMENT_MINOR, fee_amount: 0 }, today).error).toBe('')
  })

  test('fees are whole cents and never more than the payment', () => {
    expect(readSponsorPayment({ ...body, fee_amount: -1 }, today).error).toContain('fee_amount')
    expect(readSponsorPayment({ ...body, fee_amount: 1.5 }, today).error).toContain('fee_amount')
    expect(readSponsorPayment({ ...body, fee_amount: 125001 }, today).error).toContain('cannot be more')
    expect(readSponsorPayment({ ...body, fee_amount: 125000 }, today).payment?.netAmount).toBe(0)
  })

  test('the day is a real one that has happened, with a day of grace for timezones', () => {
    for (const occurred_on of ['', '2026-02-30', '2026-13-01', '20-11-2026', '2026-11-20T00:00:00Z', 20261120])
      expect(readSponsorPayment({ ...body, occurred_on }, today).error).toContain('occurred_on must be a date')
    expect(readSponsorPayment({ ...body, occurred_on: '1999-12-31' }, today).error).toContain('before 2000')
    expect(readSponsorPayment({ ...body, occurred_on: '2026-11-24' }, today).error).toBe('')
    expect(readSponsorPayment({ ...body, occurred_on: '2026-11-25' }, today).error).toContain('future')
    expect(readSponsorPayment({ ...body, occurred_on: '2027-01-01' }, '2026-12-31').error).toBe('')
  })

  test('the key is a UUID the form made', () => {
    for (const bad of ['', 'not-a-uuid', 'sponsor:1', null, 42])
      expect(readSponsorPayment({ ...body, key: bad }, today).error).toContain('key')
  })
})

describe('the ledger entry', () => {
  test('its source names the sponsor and the key, so a retry hits the unique index', () => {
    expect(sponsorPaymentSource(7, key)).toBe(`sponsor:7:${key}`)
    expect(sponsorPaymentSource(7, key)).toBe(sponsorPaymentSource(7, key))
  })

  test('one currency, the one the command center sums', () => {
    expect(EARNING_CURRENCY).toBe('USD')
  })

  test('the page and the server agree on the largest payment', () => {
    expect(PAGE_MAX).toBe(MAX_PAYMENT_MINOR)
  })

  test('the route is behind auth and team, and the action checks the role and the sponsor\'s workspace', async () => {
    const routes = await Bun.file(new URL('../../routes/api.ts', import.meta.url)).text()
    expect(routes).toMatch(/route\.post\('\/v1\/sponsors\/\{id\}\/payments', 'Actions\/Api\/V1\/Monetization\/RecordSponsorPaymentAction'\)\.middleware\('auth'\)\.middleware\('team'\)/)
    const action = await Bun.file(new URL('../../app/Actions/Api/V1/Monetization/RecordSponsorPaymentAction.ts', import.meta.url)).text()
    expect(action).toContain('canRecordEarnings(membership?.role)')
    expect(action).toMatch(/selectFrom\('sponsors'[\s\S]*?\.where\('team_id' as any, '=', teamId\)/)
    expect(action).toContain(`source_type: 'sponsorship'`)
  })
})

describe('correcting an entry', () => {
  test('a reversal negates every amount, so the two sum to nothing', () => {
    const entry = { gross_amount: 125050, fee_amount: 3625, net_amount: 121425 }
    const reversal = reversalAmounts(entry)
    expect(reversal).toEqual({ gross_amount: -125050, fee_amount: -3625, net_amount: -121425 })
    expect(entry.net_amount + reversal.net_amount).toBe(0)
    expect(Object.is(reversalAmounts({ gross_amount: 500, fee_amount: 0, net_amount: 500 }).fee_amount, 0)).toBe(true)
  })

  test('its source names the entry it cancels, once', () => {
    expect(reversalSource(12)).toBe('reversal:12')
    expect(reversedIdOf('reversal:12')).toBe(12)
    for (const value of [`sponsor:7:${key}`, 'reversal:', 'reversal:12:x', '', null, undefined])
      expect(reversedIdOf(value)).toBe(0)
  })

  test('the page reads reversals the way the server writes them', () => {
    for (const value of ['reversal:12', 'reversal:1', `sponsor:7:${key}`, 'reversal:x'])
      expect(pageReversedIdOf(value)).toBe(reversedIdOf(value))
  })

  test('the model allows the negative amounts a reversal carries', async () => {
    const model = await Bun.file(new URL('../../app/Models/Earning.ts', import.meta.url)).text()
    expect(model).not.toMatch(/(?:gross|fee|net)Amount:[^\n]*min\(0\)/)
  })

  test('the route is behind auth and team; the action checks the role, the workspace and that it is not a reversal', async () => {
    const routes = await Bun.file(new URL('../../routes/api.ts', import.meta.url)).text()
    expect(routes).toMatch(/route\.post\('\/v1\/earnings\/\{id\}\/reverse', 'Actions\/Api\/V1\/Monetization\/ReverseEarningAction'\)\.middleware\('auth'\)\.middleware\('team'\)/)
    const action = await Bun.file(new URL('../../app/Actions/Api/V1/Monetization/ReverseEarningAction.ts', import.meta.url)).text()
    expect(action).toContain('canRecordEarnings(membership?.role)')
    expect(action).toMatch(/selectFrom\('earnings'[\s\S]*?\.where\('team_id' as any, '=', teamId\)/)
    expect(action).toContain('if (reversedIdOf(entry.source_id))')
    expect(action).not.toMatch(/updateTable|deleteFrom/)
  })
})
