import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AudienceExport',
  table: 'audience_exports',
  belongsTo: ['Team', 'Audience'],
  indexes: [{ name: 'audience_exports_team_status_index', columns: ['team_id', 'status'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'audience-exports', routes: ['index', 'store', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    status: { required: true, fillable: false, default: 'pending', validation: { rule: schema.enum(['pending', 'processing', 'completed', 'expired', 'failed']) }, factory: () => 'completed' },
    filters: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    storageKey: { required: false, fillable: false, hidden: true, validation: { rule: schema.string().max(500) }, factory: () => null },
    rowCount: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    expiresAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    completedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
