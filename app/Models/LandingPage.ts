import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'LandingPage',
  table: 'landing_pages',
  belongsTo: ['Team', 'Site', 'Publication'],
  indexes: [{ name: 'landing_pages_team_slug_unique', columns: ['team_id', 'site_id', 'slug'], unique: true }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'landing-pages', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
  },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(160) }, factory: () => 'Reader welcome' },
    slug: { required: true, fillable: true, validation: { rule: schema.string().max(160) }, factory: () => 'reader-welcome' },
    status: { required: true, fillable: true, default: 'draft', validation: { rule: schema.enum(['draft', 'scheduled', 'published', 'archived']) }, factory: () => 'draft' },
    document: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({ blocks: [] }) },
    seo: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    publishedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
