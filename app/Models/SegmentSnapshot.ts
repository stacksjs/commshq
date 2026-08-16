import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'SegmentSnapshot',
  table: 'segment_snapshots',
  belongsTo: ['Team', 'Segment'],
  indexes: [{ name: 'segment_snapshots_team_segment_index', columns: ['team_id', 'segment_id', 'created_at'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'segment-snapshots', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    ruleChecksum: { required: true, fillable: false, validation: { rule: schema.string().max(128) }, factory: () => 'demo' },
    contactIds: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify([]) },
    contactCount: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    source: { required: true, fillable: false, default: 'campaign', validation: { rule: schema.enum(['campaign', 'automation', 'export', 'preview']) }, factory: () => 'preview' },
    createdBy: { required: true, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => 1 },
  },
} as const)
