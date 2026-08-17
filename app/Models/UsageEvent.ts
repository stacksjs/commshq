import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'UsageEvent',
  table: 'usage_events',
  belongsTo: ['Team', 'User'],
  indexes: [
    { name: 'usage_events_team_key_unique', columns: ['team_id', 'idempotency_key'], unique: true },
    { name: 'usage_events_team_meter_index', columns: ['team_id', 'meter', 'occurred_at'] },
  ],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'usage-events', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    meter: { required: true, fillable: false, validation: { rule: schema.string().max(60) }, factory: () => 'emails' },
    quantity: { required: true, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    sourceType: { required: true, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => 'CampaignSend' },
    sourceId: { required: false, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => null },
    idempotencyKey: { required: true, fillable: false, guarded: true, validation: { rule: schema.string().max(255) }, factory: faker => faker.string.uuid() },
    providerCost: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    metadata: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    occurredAt: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
  },
} as const)
