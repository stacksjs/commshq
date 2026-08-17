import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ReputationAlert',
  table: 'reputation_alerts',
  belongsTo: ['Team', 'ReputationAlertRule'],
  indexes: [
    { name: 'reputation_alerts_team_fingerprint_unique', columns: ['team_id', 'fingerprint'], unique: true },
    { name: 'reputation_alerts_team_status_index', columns: ['team_id', 'status', 'created_at'] },
  ],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'reputation-alerts', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    fingerprint: { required: true, fillable: false, guarded: true, validation: { rule: schema.string().max(128) }, factory: faker => faker.string.uuid() },
    metric: { required: true, fillable: false, validation: { rule: schema.enum(['negative_mention_count', 'mention_volume', 'average_rating', 'average_sentiment', 'unanswered_negative_count']) }, factory: () => 'negative_mention_count' },
    severity: { required: true, fillable: false, default: 'warning', validation: { rule: schema.enum(['info', 'warning', 'critical']) }, factory: () => 'warning' },
    // Decimal, not integer: average_rating and average_sentiment breach on
    // fractional values, and an integer column would round the evidence away.
    observedValue: { type: 'decimal', required: true, fillable: false, validation: { rule: schema.number() }, factory: () => 5 },
    thresholdValue: { type: 'decimal', required: true, fillable: false, validation: { rule: schema.number() }, factory: () => 3 },
    sampleSize: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 5 },
    windowStart: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
    windowEnd: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
    status: { required: true, fillable: false, default: 'open', validation: { rule: schema.enum(['open', 'acknowledged', 'resolved']) }, factory: () => 'open' },
    context: { type: 'text', required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    notifiedChannels: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify([]) },
    acknowledgedBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
    acknowledgedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    resolvedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
