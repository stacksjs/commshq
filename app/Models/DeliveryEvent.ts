import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'DeliveryEvent', table: 'delivery_events', belongsTo: ['Team', 'Contact'],
  indexes: [
    { name: 'delivery_events_provider_unique', columns: ['provider', 'provider_event_id'], unique: true },
    { name: 'delivery_events_team_occurred_index', columns: ['team_id', 'occurred_at'] },
  ],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'delivery-events', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    channel: { required: true, fillable: false, validation: { rule: schema.enum(['email', 'sms', 'push']) }, factory: () => 'email' },
    type: { required: true, fillable: false, validation: { rule: schema.enum(['queued', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'bounced', 'complained', 'unsubscribed']) }, factory: () => 'delivered' },
    provider: { required: true, fillable: false, validation: { rule: schema.string().max(60) }, factory: () => 'ts-mail' },
    providerEventId: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: faker => faker.string.uuid() },
    deliveryKey: { required: true, fillable: false, validation: { rule: schema.string().max(500) }, factory: faker => faker.string.uuid() },
    payload: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    occurredAt: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
  },
} as const)
