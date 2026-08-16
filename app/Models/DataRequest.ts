import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'DataRequest', table: 'data_requests', belongsTo: ['Team', 'Contact'],
  indexes: [{ name: 'data_requests_team_status_index', columns: ['team_id', 'status', 'requested_at'] }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'data-requests', routes: ['index', 'store', 'show', 'update'], middleware: ['auth', 'team'] } },
  attributes: {
    type: { required: true, fillable: true, validation: { rule: schema.enum(['access', 'export', 'erasure', 'restriction', 'correction']) }, factory: () => 'export' },
    status: { required: true, fillable: false, default: 'pending', validation: { rule: schema.enum(['pending', 'verifying', 'processing', 'completed', 'rejected']) }, factory: () => 'pending' },
    jurisdiction: { required: false, fillable: true, validation: { rule: schema.string().max(80) }, factory: () => 'GDPR' },
    requestedAt: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
    completedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    proof: { required: false, fillable: false, hidden: true, validation: { rule: schema.json() }, factory: () => null },
  },
} as const)
