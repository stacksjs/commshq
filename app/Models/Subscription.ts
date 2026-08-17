import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Subscription',
  table: 'subscriptions',
  belongsTo: ['Team', 'User'],
  indexes: [
    { name: 'subscriptions_provider_id_unique', columns: ['provider_id'], unique: true },
    { name: 'subscriptions_team_status_index', columns: ['team_id', 'provider_status'] },
  ],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'subscriptions', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    type: { required: true, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => 'default' },
    plan: { required: true, fillable: false, validation: { rule: schema.string().max(100) }, factory: () => 'free' },
    providerId: { required: true, fillable: false, guarded: true, validation: { rule: schema.string().max(255) }, factory: faker => `sub_${faker.string.alphanumeric(20)}` },
    providerStatus: { required: true, fillable: false, validation: { rule: schema.string().max(100) }, factory: () => 'active' },
    unitPrice: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    providerType: { required: true, fillable: false, validation: { rule: schema.string().max(100) }, factory: () => 'stripe' },
    providerPriceId: { required: false, fillable: false, guarded: true, validation: { rule: schema.string().max(255) }, factory: () => null },
    providerCustomerId: { required: false, fillable: false, guarded: true, validation: { rule: schema.string().max(255) }, factory: () => null },
    quantity: { required: true, fillable: false, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    cancelAtPeriodEnd: { required: true, fillable: false, default: false, validation: { rule: schema.boolean() }, factory: () => false },
    trialEndsAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    endsAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    lastUsedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
