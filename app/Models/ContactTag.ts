import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ContactTag',
  table: 'contact_tags',
  belongsTo: ['Team', 'Contact', 'AudienceTag'],
  indexes: [{ name: 'contact_tags_unique', columns: ['team_id', 'contact_id', 'audience_tag_id'], unique: true }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'contact-tags', routes: ['index', 'store', 'destroy'], middleware: ['auth', 'team'] },
  },
  attributes: {
    source: { required: true, fillable: true, default: 'manual', validation: { rule: schema.string().max(100) }, factory: () => 'manual' },
    appliedBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
  },
} as const)
