import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ContactIdentity', table: 'contact_identities', belongsTo: ['Team', 'Contact'],
  indexes: [{ name: 'contact_identities_team_value_unique', columns: ['team_id', 'channel', 'value'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'contact-identities', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    channel: { required: true, fillable: true, validation: { rule: schema.enum(['email', 'sms', 'push', 'external']) }, factory: () => 'email' },
    value: { required: true, fillable: true, validation: { rule: schema.string().max(255) }, factory: faker => faker.internet.email() },
    verifiedAt: { required: false, fillable: true, validation: { rule: schema.timestamp() }, factory: () => null },
    isPrimary: { required: true, fillable: true, default: false, validation: { rule: schema.boolean() }, factory: () => false },
  },
} as const)
