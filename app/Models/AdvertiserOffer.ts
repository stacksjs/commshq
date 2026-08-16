import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AdvertiserOffer', table: 'advertiser_offers', belongsTo: ['Team', 'Sponsor'], hasMany: ['AdPlacement'],
  indexes: [{ name: 'advertiser_offers_team_status', columns: ['team_id', 'status'] }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'advertiser-offers', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(180) } },
    creative: { required: true, fillable: true, validation: { rule: schema.json() } },
    budget: { required: true, fillable: true, validation: { rule: schema.number().min(0) } },
    currency: { required: true, fillable: true, default: 'USD', validation: { rule: schema.string().min(3).max(3) } },
    startsAt: { required: false, fillable: true, validation: { rule: schema.timestamp() } },
    endsAt: { required: false, fillable: true, validation: { rule: schema.timestamp() } },
    status: { required: true, fillable: true, default: 'draft', validation: { rule: schema.enum(['draft', 'offered', 'accepted', 'active', 'completed', 'cancelled']) } },
  },
  dashboard: { section: 'marketing', icon: 'i-hugeicons-briefcase-02' },
} as const)
