import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Payout', table: 'payouts', belongsTo: ['Team'],
  indexes: [{ name: 'payouts_team_status', columns: ['team_id', 'status'] }, { name: 'payouts_provider_id_unique', columns: ['provider_id'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'payouts', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    providerId: { required: false, fillable: false, validation: { rule: schema.string().max(255) } },
    amount: { required: true, fillable: false, validation: { rule: schema.number().min(0) } },
    currency: { required: true, fillable: false, default: 'USD', validation: { rule: schema.string().min(3).max(3) } },
    status: { required: true, fillable: false, default: 'pending', validation: { rule: schema.enum(['pending', 'processing', 'paid', 'failed', 'cancelled']) } },
    scheduledAt: { required: false, fillable: false, validation: { rule: schema.timestamp() } },
    paidAt: { required: false, fillable: false, validation: { rule: schema.timestamp() } },
  },
  dashboard: { section: 'commerce', icon: 'i-hugeicons-bank' },
} as const)
