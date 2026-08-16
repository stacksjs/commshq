import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'GatedResource',
  table: 'gated_resources',
  belongsTo: ['Team', 'Publication', 'Product'],
  indexes: [{ name: 'gated_resources_team_slug_unique', columns: ['team_id', 'slug'], unique: true }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'gated-resources', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
  },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(160) }, factory: () => 'Creator field guide' },
    slug: { required: true, fillable: true, validation: { rule: schema.string().max(160) }, factory: () => 'creator-field-guide' },
    access: { required: true, fillable: true, default: 'subscriber', validation: { rule: schema.enum(['subscriber', 'paid', 'product', 'segment']) }, factory: () => 'subscriber' },
    segmentId: { required: false, fillable: true, validation: { rule: schema.number().min(1) }, factory: () => null },
    storageKey: { required: false, fillable: false, hidden: true, validation: { rule: schema.string().max(500) }, factory: () => null },
    content: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({ blocks: [] }) },
    status: { required: true, fillable: true, default: 'draft', validation: { rule: schema.enum(['draft', 'published', 'archived']) }, factory: () => 'draft' },
  },
} as const)
