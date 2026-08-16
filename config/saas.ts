import type { SaasConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

export interface CommsHQPlanLimits {
  seats: number | null
  contacts: number | null
  emailsPerMonth: number | null
  publications: number | null
  customDomains: number | null
  aiGenerations: number | null
  sms: boolean
  automations: boolean
  commerceAutomation: boolean
  experiments: boolean
  advancedAnalytics: boolean
  platformFeeBasisPoints: number
}

export interface CommsHQUsagePricing {
  additionalContactsPerThousand: number
  additionalEmailsPerThousand: number
  smsMarkupBasisPoints: number
  aiMarkupBasisPoints: number
  networkFeeBasisPoints: number
}

export interface CommsHQSaasConfig extends SaasConfig {
  limits: Record<'free' | 'creator' | 'business' | 'enterprise', CommsHQPlanLimits>
  usagePricing: CommsHQUsagePricing
}

export default {
  plans: [
    { productName: 'CommsHQ Free', description: 'Start publishing and sending to your first audience.', pricing: [{ key: 'commshq_free_monthly', price: 0, interval: 'month', currency: 'usd' }], metadata: { createdBy: 'commshq', version: '1.0.0' } },
    { productName: 'CommsHQ Creator', description: 'Automations, paid content, referrals, and custom domains for independent creators.', pricing: [{ key: 'commshq_creator_monthly', price: 2900, interval: 'month', currency: 'usd' }], metadata: { createdBy: 'commshq', version: '1.0.0' } },
    { productName: 'CommsHQ Business', description: 'SMS, commerce automation, experiments, sponsorships, and advanced analytics.', pricing: [{ key: 'commshq_business_monthly', price: 9900, interval: 'month', currency: 'usd' }], metadata: { createdBy: 'commshq', version: '1.0.0' } },
    { productName: 'CommsHQ Enterprise', description: 'Custom limits, retention, security controls, support, and usage terms.', pricing: [], metadata: { createdBy: 'commshq', version: '1.0.0' } },
  ],
  limits: {
    free: { seats: 1, contacts: 1000, emailsPerMonth: 10000, publications: 1, customDomains: 0, aiGenerations: 0, sms: false, automations: false, commerceAutomation: false, experiments: false, advancedAnalytics: false, platformFeeBasisPoints: 500 },
    creator: { seats: 3, contacts: 5000, emailsPerMonth: 50000, publications: null, customDomains: 2, aiGenerations: 250, sms: false, automations: true, commerceAutomation: false, experiments: false, advancedAnalytics: false, platformFeeBasisPoints: 200 },
    business: { seats: 10, contacts: 25000, emailsPerMonth: 250000, publications: null, customDomains: 10, aiGenerations: 5000, sms: true, automations: true, commerceAutomation: true, experiments: true, advancedAnalytics: true, platformFeeBasisPoints: 50 },
    enterprise: { seats: null, contacts: null, emailsPerMonth: null, publications: null, customDomains: null, aiGenerations: null, sms: true, automations: true, commerceAutomation: true, experiments: true, advancedAnalytics: true, platformFeeBasisPoints: 0 },
  },
  usagePricing: {
    additionalContactsPerThousand: 500,
    additionalEmailsPerThousand: 100,
    smsMarkupBasisPoints: 1500,
    aiMarkupBasisPoints: 2000,
    networkFeeBasisPoints: 1000,
  },
  webhook: { endpoint: 'https://commshq.org/api/webhooks/stripe', secret: String(env.STRIPE_WEBHOOK_SECRET || '') },
  currencies: ['usd'],
  coupons: [],
  products: [
    { name: 'CommsHQ Creator', description: 'Creator plan subscription.', images: [] },
    { name: 'CommsHQ Business', description: 'Business plan subscription.', images: [] },
  ],
} satisfies CommsHQSaasConfig
