import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'WebhookEvent', table: 'webhook_events', belongsTo: ['Team', 'WebhookEndpoint'],
  indexes: [{ name: 'webhook_events_provider_unique', columns: ['provider', 'provider_event_id'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'webhook-events', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    provider: { required: true, fillable: false, validation: { rule: schema.string().max(60) }, factory: () => 'generic' },
    providerEventId: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: faker => faker.string.uuid() },
    type: { required: true, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => 'contact.created' },
    status: { required: true, fillable: false, default: 'received', validation: { rule: schema.enum(['received', 'processing', 'processed', 'failed', 'dead_lettered']) }, factory: () => 'received' },
    payload: { required: true, fillable: false, hidden: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    signatureVerified: { required: true, fillable: false, default: false, validation: { rule: schema.boolean() }, factory: () => true },
    attempts: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    error: { required: false, fillable: false, validation: { rule: schema.string() }, factory: () => null },
    processedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
