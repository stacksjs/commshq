import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'CommerceConnection', table: 'commerce_connections', belongsTo: ['Team'], hasMany: ['CommerceEvent'],
  indexes: [{ name: 'commerce_connections_team_provider_unique', columns: ['team_id', 'provider', 'external_account_id'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'commerce-connections', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    provider: { required: true, fillable: true, validation: { rule: schema.enum(['stacks', 'shopify', 'woocommerce', 'stripe', 'csv', 'api']) }, factory: () => 'stacks' },
    name: { required: true, fillable: true, validation: { rule: schema.string().max(120) }, factory: () => 'Primary store' },
    externalAccountId: { required: false, fillable: true, validation: { rule: schema.string().max(255) }, factory: () => null },
    encryptedCredentials: { required: false, fillable: false, guarded: true, hidden: true, encrypted: true, validation: { rule: schema.string() }, factory: () => null },
    status: { required: true, fillable: true, default: 'pending', validation: { rule: schema.enum(['pending', 'active', 'error', 'disabled']) }, factory: () => 'active' },
    cursor: { required: false, fillable: false, hidden: true, validation: { rule: schema.string() }, factory: () => null },
    lastSyncedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
  dashboard: { highlight: true },
} as const)
