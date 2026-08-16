import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Referral', table: 'referrals', belongsTo: ['Team', 'Publication', 'Contact'],
  indexes: [{ name: 'referrals_team_code_unique', columns: ['team_id', 'code'], unique: true }, { name: 'referrals_team_status', columns: ['team_id', 'status'] }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'referrals', routes: ['index', 'show', 'update'], middleware: ['auth', 'team'] } },
  attributes: {
    code: { required: true, fillable: true, validation: { rule: schema.string().min(6).max(64) } },
    referredEmailHash: { required: true, fillable: false, hidden: true, validation: { rule: schema.string().max(128) } },
    status: { required: true, fillable: true, default: 'clicked', validation: { rule: schema.enum(['clicked', 'pending', 'qualified', 'rewarded', 'rejected']) } },
    reward: { required: false, fillable: true, validation: { rule: schema.json() } },
    qualifiedAt: { required: false, fillable: true, validation: { rule: schema.timestamp() } },
  },
  dashboard: { highlight: true, section: 'marketing', icon: 'i-hugeicons-share-08' },
} as const)
