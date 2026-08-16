import { describe, expect, it } from 'bun:test'
import saas from '../../config/saas'
import { calculateUsageCharges } from '../../app/Actions/Billing/calculate-usage'

describe('usage billing', () => {
  it('bills overages in whole thousand-unit blocks', () => {
    const result = calculateUsageCharges({ contacts: 25_001, emails: 251_001, smsProviderCost: 10_000, aiProviderCost: 5_000, paidContentGross: 100_000, networkGross: 50_000 }, saas.limits.business, saas.usagePricing)
    expect(result.contacts).toBe(500)
    expect(result.emails).toBe(200)
    expect(result.sms).toBe(11_500)
    expect(result.ai).toBe(6_000)
    expect(result.paidContent).toBe(500)
    expect(result.network).toBe(5_000)
    expect(result.total).toBe(23_700)
  })

  it('does not invent enterprise contact or email limits', () => {
    const result = calculateUsageCharges({ contacts: 1_000_000, emails: 2_000_000, smsProviderCost: 0, aiProviderCost: 0, paidContentGross: 0, networkGross: 0 }, saas.limits.enterprise, saas.usagePricing)
    expect(result.contacts).toBe(0)
    expect(result.emails).toBe(0)
  })

  it('never creates negative credits from malformed usage', () => {
    const result = calculateUsageCharges({ contacts: -1, emails: Number.NaN, smsProviderCost: -10, aiProviderCost: -10, paidContentGross: -10, networkGross: -10 }, saas.limits.free, saas.usagePricing)
    expect(result.total).toBe(0)
  })
})
