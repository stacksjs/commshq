import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Publication', table: 'publications', belongsTo: ['Team', 'Site'], hasMany: ['PublicationMember', 'Podcast', 'Referral'],
  indexes: [{ name: 'publications_team_slug_unique', columns: ['team_id', 'slug'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, observe: true, useApi: { prefix: 'v1', uri: 'publications', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(160) } },
    slug: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(120).matches(/^[a-z0-9-]+$/) } },
    description: { required: false, fillable: true, validation: { rule: schema.string().max(1000) } },
    status: { required: true, fillable: true, default: 'draft', validation: { rule: schema.enum(['draft', 'active', 'paused', 'archived']) } },
    access: { required: true, fillable: true, default: 'free', validation: { rule: schema.enum(['free', 'paid', 'mixed']) } },
    settings: { required: false, fillable: true, validation: { rule: schema.json() } },
  },
  dashboard: { highlight: true, section: 'content', icon: 'i-hugeicons-news-01' },
} as const)
