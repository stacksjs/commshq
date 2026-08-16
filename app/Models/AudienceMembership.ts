import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AudienceMembership', table: 'audience_memberships', belongsTo: ['Team', 'Audience', 'Contact'],
  indexes: [{ name: 'audience_memberships_unique', columns: ['audience_id', 'contact_id'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'audience-memberships', routes: ['index', 'store', 'show', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    status: { required: true, fillable: true, default: 'active', validation: { rule: schema.enum(['active', 'pending', 'unsubscribed']) }, factory: () => 'active' },
    joinedAt: { required: true, fillable: true, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
    leftAt: { required: false, fillable: true, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
