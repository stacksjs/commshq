import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AudienceImport',
  table: 'audience_imports',
  belongsTo: ['Team', 'Audience'],
  indexes: [{ name: 'audience_imports_team_status_index', columns: ['team_id', 'status'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'audience-imports', routes: ['index', 'store', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    filename: { required: true, fillable: true, validation: { rule: schema.string().max(255) }, factory: () => 'contacts.csv' },
    storageKey: { required: true, fillable: false, hidden: true, validation: { rule: schema.string().max(500) }, factory: () => 'imports/contacts.csv' },
    status: { required: true, fillable: false, default: 'pending', validation: { rule: schema.enum(['pending', 'validating', 'processing', 'completed', 'failed']) }, factory: () => 'completed' },
    mapping: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({ email: 'email' }) },
    totalRows: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    importedRows: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    rejectedRows: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    errorReportKey: { required: false, fillable: false, hidden: true, validation: { rule: schema.string().max(500) }, factory: () => null },
    completedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
