import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Episode', table: 'episodes', belongsTo: ['Team', 'Podcast'],
  indexes: [{ name: 'episodes_podcast_slug_unique', columns: ['podcast_id', 'slug'], unique: true }, { name: 'episodes_team_published', columns: ['team_id', 'published_at'] }],
  traits: { useUuid: true, useTimestamps: true, observe: true, useApi: { prefix: 'v1', uri: 'episodes', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    title: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(200) } },
    slug: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(120).matches(/^[a-z0-9-]+$/) } },
    summary: { required: false, fillable: true, validation: { rule: schema.string().max(4000) } },
    audioUrl: { required: true, fillable: true, validation: { rule: schema.string().max(2048) } },
    durationSeconds: { required: false, fillable: true, validation: { rule: schema.number().min(0) } },
    publishedAt: { required: false, fillable: true, validation: { rule: schema.timestamp() } },
    status: { required: true, fillable: true, default: 'draft', validation: { rule: schema.enum(['draft', 'scheduled', 'published', 'archived']) } },
  },
  dashboard: { section: 'content', icon: 'i-hugeicons-mic-01' },
} as const)
