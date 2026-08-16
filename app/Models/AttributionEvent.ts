import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AttributionEvent', table: 'attribution_events', belongsTo: ['Team', 'Contact', 'CommerceEvent', 'Campaign'],
  indexes: [{ name: 'attribution_events_team_occurred', columns: ['team_id', 'occurred_at'] }, { name: 'attribution_events_dedupe_unique', columns: ['team_id', 'dedupe_key'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'attribution-events', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    kind: { required: true, fillable: false, validation: { rule: schema.enum(['visit', 'signup', 'conversion', 'purchase', 'renewal', 'churn']) } },
    source: { required: true, fillable: false, validation: { rule: schema.string().max(120) } },
    medium: { required: false, fillable: false, validation: { rule: schema.string().max(120) } },
    campaignKey: { required: false, fillable: false, validation: { rule: schema.string().max(160) } },
    revenue: { required: false, fillable: false, validation: { rule: schema.number().min(0) } },
    currency: { required: false, fillable: false, validation: { rule: schema.string().min(3).max(3) } },
    dedupeKey: { required: true, fillable: false, hidden: true, validation: { rule: schema.string().max(128) } },
    occurredAt: { required: true, fillable: false, validation: { rule: schema.timestamp() } },
  },
  dashboard: { highlight: true, section: 'analytics', icon: 'i-hugeicons-source-code-circle' },
} as const)
