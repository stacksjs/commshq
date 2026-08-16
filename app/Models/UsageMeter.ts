import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'UsageMeter', table: 'usage_meters', belongsTo: ['Team'],
  indexes: [{ name: 'usage_meters_team_period_unique', columns: ['team_id', 'key', 'period_start'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'usage-meters', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    key: { required: true, fillable: false, validation: { rule: schema.enum(['contacts', 'emails', 'sms_segments', 'ai_generations', 'custom_domains']) } },
    quantity: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) } },
    includedQuantity: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) } },
    periodStart: { required: true, fillable: false, validation: { rule: schema.timestamp() } },
    periodEnd: { required: true, fillable: false, validation: { rule: schema.timestamp() } },
  },
  dashboard: { highlight: true, section: 'management', icon: 'i-hugeicons-dashboard-speed-01' },
} as const)
