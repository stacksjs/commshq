import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'SegmentRule', table: 'segment_rules', belongsTo: ['Team', 'Segment'],
  indexes: [{ name: 'segment_rules_segment_position_index', columns: ['segment_id', 'position'] }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'segment-rules', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    field: { required: true, fillable: true, validation: { rule: schema.string().max(120) }, factory: () => 'engagement_score' },
    operator: { required: true, fillable: true, validation: { rule: schema.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'before', 'after', 'exists', 'not_exists', 'in']) }, factory: () => 'greater_than' },
    value: { required: false, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify(70) },
    position: { required: true, fillable: true, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
  },
} as const)
