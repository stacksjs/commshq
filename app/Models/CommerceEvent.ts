import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'CommerceEvent', table: 'commerce_events', belongsTo: ['Team', 'CommerceConnection', 'Contact'],
  indexes: [
    { name: 'commerce_events_provider_unique', columns: ['commerce_connection_id', 'external_id'], unique: true },
    { name: 'commerce_events_team_type_index', columns: ['team_id', 'type', 'occurred_at'] },
  ],
  traits: { useUuid: true, useTimestamps: true, observe: true, useApi: { prefix: 'v1', uri: 'commerce-events', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    externalId: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: faker => faker.string.uuid() },
    type: { required: true, fillable: false, validation: { rule: schema.enum(['product_viewed', 'cart_updated', 'checkout_started', 'order_created', 'order_paid', 'order_fulfilled', 'order_refunded', 'subscription_changed']) }, factory: () => 'order_paid' },
    amount: { required: false, fillable: false, validation: { rule: schema.number().min(0) }, factory: faker => faker.number.int({ min: 1500, max: 24000 }) },
    currency: { required: false, fillable: false, default: 'USD', validation: { rule: schema.string().max(3) }, factory: () => 'USD' },
    payload: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    occurredAt: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
  },
} as const)
