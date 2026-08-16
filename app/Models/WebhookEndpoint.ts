import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'WebhookEndpoint', table: 'webhook_endpoints', belongsTo: ['Team'], hasMany: ['WebhookEvent'],
  indexes: [{ name: 'webhook_endpoints_team_name_unique', columns: ['team_id', 'provider', 'name'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'webhook-endpoints', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(120) }, factory: () => 'Commerce events' },
    provider: { required: true, fillable: true, validation: { rule: schema.enum(['twilio', 'stripe', 'shopify', 'woocommerce', 'mail', 'generic']) }, factory: () => 'generic' },
    direction: { required: true, fillable: false, default: 'inbound', validation: { rule: schema.enum(['inbound', 'outbound']) }, factory: () => 'inbound' },
    url: { required: false, fillable: true, validation: { rule: schema.string().url().max(2048) }, factory: () => null },
    encryptedSecret: { required: true, fillable: false, guarded: true, hidden: true, encrypted: true, validation: { rule: schema.string() }, factory: faker => faker.string.uuid() },
    events: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify(['contact.created']) },
    status: { required: true, fillable: true, default: 'active', validation: { rule: schema.enum(['active', 'paused', 'failing']) }, factory: () => 'active' },
  },
} as const)
