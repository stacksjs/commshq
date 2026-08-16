import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AutomationDeadLetter',
  table: 'automation_dead_letters',
  belongsTo: ['Team', 'Automation', 'AutomationRun', 'AutomationStepRun'],
  indexes: [{ name: 'automation_dead_letters_team_status_index', columns: ['team_id', 'status', 'created_at'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'automation-dead-letters', routes: ['index', 'show', 'update'], middleware: ['auth', 'team'] },
  },
  attributes: {
    nodeId: { required: true, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => 'send-email' },
    payload: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    errorClass: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: () => 'ProviderError' },
    errorMessage: { required: true, fillable: false, validation: { rule: schema.string().max(2000) }, factory: () => 'Delivery failed' },
    attempts: { required: true, fillable: false, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    status: { required: true, fillable: false, default: 'open', validation: { rule: schema.enum(['open', 'replaying', 'recovered', 'discarded']) }, factory: () => 'open' },
    recoveredBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
    recoveredAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
