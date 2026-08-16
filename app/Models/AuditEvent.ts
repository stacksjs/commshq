import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AuditEvent', table: 'audit_events', belongsTo: ['Team', 'User'],
  indexes: [{ name: 'audit_events_team_occurred_index', columns: ['team_id', 'occurred_at'] }],
  traits: { useUuid: true, useTimestamps: false, useApi: { prefix: 'v1', uri: 'audit-events', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    action: { required: true, fillable: false, validation: { rule: schema.string().max(160) }, factory: () => 'campaign.published' },
    subjectType: { required: false, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => 'Campaign' },
    subjectId: { required: false, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => '1' },
    metadata: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    ipAddress: { required: false, fillable: false, validation: { rule: schema.string().max(45) }, factory: faker => faker.internet.ip() },
    occurredAt: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
  },
} as const)
