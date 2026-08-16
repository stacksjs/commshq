import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'DeliveryAttempt',
  table: 'delivery_attempts',
  belongsTo: ['Team', 'CampaignRecipient', 'CampaignSend'],
  indexes: [
    { name: 'delivery_attempts_idempotency_unique', columns: ['team_id', 'idempotency_key'], unique: true },
    { name: 'delivery_attempts_status_retry_index', columns: ['team_id', 'status', 'retry_at'] },
  ],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'delivery-attempts', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    channel: { required: true, fillable: false, validation: { rule: schema.enum(['email', 'sms']) }, factory: () => 'email' },
    provider: { required: true, fillable: false, validation: { rule: schema.string().max(100) }, factory: () => 'mail' },
    providerMessageId: { required: false, fillable: false, validation: { rule: schema.string().max(255) }, factory: () => null },
    idempotencyKey: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: faker => faker.string.uuid() },
    attempt: { required: true, fillable: false, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    status: { required: true, fillable: false, default: 'pending', validation: { rule: schema.enum(['pending', 'sending', 'deferred', 'sent', 'failed', 'dead_lettered']) }, factory: () => 'pending' },
    retryClass: { required: false, fillable: false, validation: { rule: schema.enum(['transient', 'rate_limited', 'permanent', 'suppressed']) }, factory: () => null },
    errorCode: { required: false, fillable: false, validation: { rule: schema.string().max(100) }, factory: () => null },
    errorMessage: { required: false, fillable: false, validation: { rule: schema.string().max(1000) }, factory: () => null },
    retryAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    attemptedAt: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
  },
} as const)
