import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AutomationApproval',
  table: 'automation_approvals',
  belongsTo: ['Team', 'Automation', 'AutomationRun', 'AutomationStepRun'],
  indexes: [{ name: 'automation_approvals_team_status_index', columns: ['team_id', 'status', 'expires_at'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'automation-approvals', routes: ['index', 'show', 'update'], middleware: ['auth', 'team'] },
  },
  attributes: {
    action: { required: true, fillable: false, validation: { rule: schema.string().max(100) }, factory: () => 'send_email' },
    payload: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    status: { required: true, fillable: true, default: 'pending', validation: { rule: schema.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']) }, factory: () => 'pending' },
    requestedBy: { required: true, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    decidedBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
    reason: { required: false, fillable: true, validation: { rule: schema.string().max(1000) }, factory: () => null },
    expiresAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    decidedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
