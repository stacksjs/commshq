import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Commission',
  table: 'commissions',
  belongsTo: ['Team', 'Earning', 'Referral', 'Recommendation'],
  indexes: [{ name: 'commissions_team_status_index', columns: ['team_id', 'status', 'created_at'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'commissions', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    kind: { required: true, fillable: false, validation: { rule: schema.enum(['referral', 'recommendation', 'sponsorship', 'affiliate']) }, factory: () => 'referral' },
    grossAmount: { required: true, fillable: false, validation: { rule: schema.number().min(0) }, factory: () => 10000 },
    feeBasisPoints: { required: true, fillable: false, validation: { rule: schema.number().min(0).max(10000) }, factory: () => 1000 },
    feeAmount: { required: true, fillable: false, validation: { rule: schema.number().min(0) }, factory: () => 1000 },
    netAmount: { required: true, fillable: false, validation: { rule: schema.number().min(0) }, factory: () => 9000 },
    currency: { required: true, fillable: false, default: 'usd', validation: { rule: schema.string().max(3) }, factory: () => 'usd' },
    status: { required: true, fillable: false, default: 'pending', validation: { rule: schema.enum(['pending', 'approved', 'payable', 'paid', 'reversed']) }, factory: () => 'pending' },
    payableAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    paidAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
