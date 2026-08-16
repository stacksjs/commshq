import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'DataRetentionPolicy',
  table: 'data_retention_policies',
  belongsTo: ['Team'],
  indexes: [{ name: 'data_retention_policies_team_kind_unique', columns: ['team_id', 'kind'], unique: true }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'data-retention-policies', routes: ['index', 'store', 'show', 'update'], middleware: ['auth', 'team'] },
  },
  attributes: {
    kind: { required: true, fillable: true, validation: { rule: schema.enum(['contacts', 'events', 'deliveries', 'analytics', 'audit', 'integrations']) }, factory: () => 'events' },
    retentionDays: { required: true, fillable: true, validation: { rule: schema.number().min(1) }, factory: () => 365 },
    legalHold: { required: true, fillable: false, default: false, validation: { rule: schema.boolean() }, factory: () => false },
    jurisdiction: { required: false, fillable: true, validation: { rule: schema.string().max(10) }, factory: () => null },
    status: { required: true, fillable: true, default: 'active', validation: { rule: schema.enum(['active', 'paused']) }, factory: () => 'active' },
  },
} as const)
