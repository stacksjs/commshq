import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AudienceTag', table: 'audience_tags', belongsTo: ['Team'],
  indexes: [{ name: 'audience_tags_team_name_unique', columns: ['team_id', 'name'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'audience-tags', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(80) }, factory: faker => faker.helpers.arrayElement(['customer', 'creator', 'vip', 'lead']) },
    color: { required: true, fillable: true, default: 'coral', validation: { rule: schema.string().max(32) }, factory: () => 'coral' },
  },
} as const)
