import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Earning', table: 'earnings', belongsTo: ['Team', 'AdPlacement'],
  indexes: [{ name: 'earnings_team_occurred', columns: ['team_id', 'occurred_at'] }, { name: 'earnings_source_unique', columns: ['source_type', 'source_id'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'earnings', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  // Amounts are minor units. They are negative only on a reversal, the entry
  // that cancels a wrong one (app/Support/earnings.ts); nothing is edited.
  attributes: {
    sourceType: { required: true, fillable: false, validation: { rule: schema.enum(['paid_publication', 'sponsorship', 'recommendation', 'digital_product', 'referral']) } },
    sourceId: { required: true, fillable: false, validation: { rule: schema.string().max(128) } },
    grossAmount: { required: true, fillable: false, validation: { rule: schema.number() } },
    feeAmount: { required: true, fillable: false, validation: { rule: schema.number() } },
    netAmount: { required: true, fillable: false, validation: { rule: schema.number() } },
    currency: { required: true, fillable: false, default: 'USD', validation: { rule: schema.string().min(3).max(3) } },
    occurredAt: { required: true, fillable: false, validation: { rule: schema.timestamp() } },
  },
  dashboard: { highlight: true, section: 'commerce', icon: 'i-hugeicons-money-receive-circle' },
} as const)
