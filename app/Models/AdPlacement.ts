import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AdPlacement', table: 'ad_placements', belongsTo: ['Team', 'AdvertiserOffer', 'Campaign', 'Publication'],
  indexes: [{ name: 'ad_placements_team_status', columns: ['team_id', 'status'] }, { name: 'ad_placements_offer_slot_unique', columns: ['advertiser_offer_id', 'slot_key'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'ad-placements', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    slotKey: { required: true, fillable: true, validation: { rule: schema.string().max(120) } },
    rate: { required: true, fillable: true, validation: { rule: schema.number().min(0) } },
    impressions: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) } },
    clicks: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) } },
    status: { required: true, fillable: true, default: 'reserved', validation: { rule: schema.enum(['reserved', 'approved', 'delivered', 'cancelled']) } },
  },
  dashboard: { section: 'marketing', icon: 'i-hugeicons-layout-table-02' },
} as const)
