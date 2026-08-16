import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Podcast', table: 'podcasts', belongsTo: ['Team', 'Publication'], hasMany: ['Episode'],
  indexes: [{ name: 'podcasts_team_slug_unique', columns: ['team_id', 'slug'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'podcasts', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    title: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(180) } },
    slug: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(120).matches(/^[a-z0-9-]+$/) } },
    description: { required: false, fillable: true, validation: { rule: schema.string().max(4000) } },
    author: { required: true, fillable: true, validation: { rule: schema.string().max(160) } },
    explicit: { required: true, fillable: true, default: false, validation: { rule: schema.boolean() } },
    status: { required: true, fillable: true, default: 'draft', validation: { rule: schema.enum(['draft', 'active', 'archived']) } },
  },
  dashboard: { section: 'content', icon: 'i-hugeicons-podcast' },
} as const)
