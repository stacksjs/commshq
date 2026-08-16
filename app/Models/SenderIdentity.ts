import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'SenderIdentity', table: 'sender_identities', belongsTo: ['Team', 'SenderDomain'],
  indexes: [{ name: 'sender_identities_team_address_unique', columns: ['team_id', 'channel', 'address'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, observe: true, useApi: { prefix: 'v1', uri: 'sender-identities', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    channel: { required: true, fillable: true, validation: { rule: schema.enum(['email', 'sms']) } },
    name: { required: true, fillable: true, validation: { rule: schema.string().max(160) } },
    address: { required: true, fillable: true, validation: { rule: schema.string().max(255) } },
    replyTo: { required: false, fillable: true, validation: { rule: schema.string().max(255) } },
    status: { required: true, fillable: false, default: 'pending', validation: { rule: schema.enum(['pending', 'verified', 'disabled', 'failed']) } },
    verification: { required: false, fillable: false, validation: { rule: schema.json() } },
  },
  dashboard: { highlight: true, section: 'marketing', icon: 'i-hugeicons-mail-account-01' },
} as const)
