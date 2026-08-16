import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Contact', table: 'contacts', belongsTo: ['Team'],
  hasMany: ['ContactIdentity', 'AudienceMembership', 'ConsentEvent', 'ContactMerge'],
  indexes: [
    { name: 'contacts_team_email_unique', columns: ['team_id', 'email'], unique: true },
    { name: 'contacts_team_status_index', columns: ['team_id', 'status'] },
  ],
  traits: {
    useUuid: true, useTimestamps: true, observe: true,
    useSearch: { searchable: ['email', 'firstName', 'lastName'], filterable: ['teamId', 'status'], sortable: ['createdAt'] },
    useApi: { prefix: 'v1', uri: 'contacts', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
    useSeeder: { count: 36 },
  },
  attributes: {
    email: { required: false, fillable: true, validation: { rule: schema.string().email().max(255) }, factory: faker => faker.internet.email() },
    phone: { required: false, fillable: true, validation: { rule: schema.string().max(32) }, factory: () => null },
    firstName: { required: false, fillable: true, validation: { rule: schema.string().max(100) }, factory: faker => faker.person.firstName() },
    lastName: { required: false, fillable: true, validation: { rule: schema.string().max(100) }, factory: faker => faker.person.lastName() },
    status: { required: true, fillable: true, default: 'active', validation: { rule: schema.enum(['active', 'pending', 'unsubscribed', 'suppressed', 'archived']) }, factory: () => 'active' },
    source: { required: true, fillable: true, default: 'manual', validation: { rule: schema.string().max(100) }, factory: () => 'demo' },
    properties: { required: false, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    lastEngagedAt: { required: false, fillable: true, validation: { rule: schema.timestamp() }, factory: () => null },
  },
  dashboard: { highlight: true },
} as const)
