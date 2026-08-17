import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ReputationAlertRule',
  table: 'reputation_alert_rules',
  belongsTo: ['Team'],
  indexes: [
    { name: 'reputation_alert_rules_team_name_unique', columns: ['team_id', 'name'], unique: true },
    { name: 'reputation_alert_rules_due_index', columns: ['status', 'next_evaluation_at'] },
  ],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'reputation-alert-rules', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    name: { required: true, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => 'Negative review spike' },
    metric: { required: true, fillable: false, validation: { rule: schema.enum(['negative_mention_count', 'mention_volume', 'average_rating', 'average_sentiment', 'unanswered_negative_count']) }, factory: () => 'negative_mention_count' },
    comparator: { required: true, fillable: false, validation: { rule: schema.enum(['gte', 'lte']) }, factory: () => 'gte' },
    // Decimal so a rating rule can be set to something like 4.2.
    threshold: { type: 'decimal', required: true, fillable: false, validation: { rule: schema.number() }, factory: () => 3 },
    windowMinutes: { required: true, fillable: false, default: 1_440, validation: { rule: schema.number().min(15).max(43_200) }, factory: () => 1_440 },
    minimumSampleSize: { required: true, fillable: false, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    platforms: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify([]) },
    severity: { required: true, fillable: false, default: 'warning', validation: { rule: schema.enum(['info', 'warning', 'critical']) }, factory: () => 'warning' },
    channels: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify(['database', 'email']) },
    cooldownMinutes: { required: true, fillable: false, default: 360, validation: { rule: schema.number().min(15).max(43_200) }, factory: () => 360 },
    status: { required: true, fillable: false, default: 'active', validation: { rule: schema.enum(['active', 'paused']) }, factory: () => 'active' },
    nextEvaluationAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
    lastEvaluatedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    lastTriggeredAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
