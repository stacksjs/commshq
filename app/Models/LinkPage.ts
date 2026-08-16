import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'LinkPage',
  table: 'link_pages',
  belongsTo: ['Team', 'Site', 'Publication'],
  indexes: [{ name: 'link_pages_team_slug_unique', columns: ['team_id', 'site_id', 'slug'], unique: true }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'link-pages', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
  },
  attributes: {
    title: { required: true, fillable: true, validation: { rule: schema.string().max(160) }, factory: () => 'Find us everywhere' },
    slug: { required: true, fillable: true, validation: { rule: schema.string().max(160) }, factory: () => 'links' },
    bio: { required: false, fillable: true, validation: { rule: schema.string().max(500) }, factory: () => null },
    links: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify([]) },
    theme: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({ style: 'editorial' }) },
    status: { required: true, fillable: true, default: 'draft', validation: { rule: schema.enum(['draft', 'published', 'archived']) }, factory: () => 'draft' },
  },
} as const)
