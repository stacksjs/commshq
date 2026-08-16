import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AutomationStepRun', table: 'automation_step_runs', belongsTo: ['Team', 'AutomationRun'],
  indexes: [{ name: 'automation_step_runs_idempotency_unique', columns: ['idempotency_key'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'automation-step-runs', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    nodeId: { required: true, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => 'send-welcome' },
    type: { required: true, fillable: false, validation: { rule: schema.string().max(80) }, factory: () => 'send_email' },
    status: { required: true, fillable: false, default: 'queued', validation: { rule: schema.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'dead_lettered', 'cancelled']) }, factory: () => 'queued' },
    attempt: { required: true, fillable: false, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    idempotencyKey: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: faker => faker.string.uuid() },
    input: { required: false, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    output: { required: false, fillable: false, validation: { rule: schema.json() }, factory: () => null },
    error: { required: false, fillable: false, validation: { rule: schema.string() }, factory: () => null },
    availableAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    startedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    completedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
