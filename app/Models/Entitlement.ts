import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Entitlement', table: 'entitlements', belongsTo: ['Team', 'Subscription'],
  indexes: [{ name: 'entitlements_team_key_unique', columns: ['team_id', 'key'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'entitlements', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    key: { required: true, fillable: false, validation: { rule: schema.string().max(120) } },
    value: { required: true, fillable: false, validation: { rule: schema.json() } },
    source: { required: true, fillable: false, default: 'plan', validation: { rule: schema.enum(['plan', 'override', 'promotion']) } },
    expiresAt: { required: false, fillable: false, validation: { rule: schema.timestamp() } },
  },
  dashboard: { section: 'management', icon: 'i-hugeicons-key-02' },
} as const)
