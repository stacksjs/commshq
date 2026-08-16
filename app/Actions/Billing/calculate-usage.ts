import type { CommsHQPlanLimits, CommsHQUsagePricing } from '../../../config/saas'

export interface UsageInput {
  contacts: number
  emails: number
  smsProviderCost: number
  aiProviderCost: number
  paidContentGross: number
  networkGross: number
}

export interface UsageCharge {
  contacts: number
  emails: number
  sms: number
  ai: number
  paidContent: number
  network: number
  total: number
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function thousandBlocks(used: number, included: number | null): number {
  if (included === null) return 0
  return Math.ceil(Math.max(0, nonNegative(used) - included) / 1000)
}

function markedUp(cost: number, basisPoints: number): number {
  return Math.round(nonNegative(cost) * (10_000 + basisPoints) / 10_000)
}

export function calculateUsageCharges(input: UsageInput, limits: CommsHQPlanLimits, pricing: CommsHQUsagePricing): UsageCharge {
  const charges = {
    contacts: thousandBlocks(input.contacts, limits.contacts) * pricing.additionalContactsPerThousand,
    emails: thousandBlocks(input.emails, limits.emailsPerMonth) * pricing.additionalEmailsPerThousand,
    sms: markedUp(input.smsProviderCost, pricing.smsMarkupBasisPoints),
    ai: markedUp(input.aiProviderCost, pricing.aiMarkupBasisPoints),
    paidContent: Math.round(nonNegative(input.paidContentGross) * limits.platformFeeBasisPoints / 10_000),
    network: Math.round(nonNegative(input.networkGross) * pricing.networkFeeBasisPoints / 10_000),
  }

  return { ...charges, total: Object.values(charges).reduce((total, amount) => total + amount, 0) }
}
