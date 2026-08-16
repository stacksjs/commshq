import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'CampaignExperiment',
  table: 'campaign_experiments',
  belongsTo: ['Team', 'Campaign'],
  hasMany: ['CampaignVariant'],
  indexes: [{ name: 'campaign_experiments_team_campaign_index', columns: ['team_id', 'campaign_id'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'campaign-experiments', routes: ['index', 'store', 'show', 'update'], middleware: ['auth', 'team'] },
  },
  attributes: {
    kind: { required: true, fillable: true, validation: { rule: schema.enum(['subject', 'sender', 'content', 'send_time']) }, factory: () => 'subject' },
    allocation: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({ test: 20, winner: 80 }) },
    winningMetric: { required: true, fillable: true, validation: { rule: schema.enum(['open_rate', 'click_rate', 'conversion_rate', 'revenue']) }, factory: () => 'click_rate' },
    status: { required: true, fillable: false, default: 'draft', validation: { rule: schema.enum(['draft', 'running', 'evaluating', 'completed', 'cancelled']) }, factory: () => 'draft' },
    winnerVariantId: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
    evaluateAt: { required: false, fillable: true, validation: { rule: schema.timestamp() }, factory: () => null },
    completedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
