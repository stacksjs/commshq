import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'PublicationMember', table: 'publication_members', belongsTo: ['Team', 'Publication', 'Contact'],
  indexes: [{ name: 'publication_members_unique', columns: ['publication_id', 'contact_id'], unique: true }, { name: 'publication_members_team_status', columns: ['team_id', 'status'] }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'publication-members', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    status: { required: true, fillable: true, default: 'pending', validation: { rule: schema.enum(['pending', 'active', 'cancelled', 'past_due']) } },
    tier: { required: true, fillable: true, default: 'free', validation: { rule: schema.string().max(80) } },
    startedAt: { required: false, fillable: true, validation: { rule: schema.timestamp() } },
    endedAt: { required: false, fillable: true, validation: { rule: schema.timestamp() } },
  },
  dashboard: { section: 'content', icon: 'i-hugeicons-user-group' },
} as const)
