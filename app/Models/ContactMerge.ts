import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ContactMerge', table: 'contact_merges', belongsTo: ['Team', 'Contact'],
  indexes: [{ name: 'contact_merges_team_created_index', columns: ['team_id', 'created_at'] }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'contact-merges', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    sourceContactUuid: { required: true, fillable: true, validation: { rule: schema.string().max(64) }, factory: faker => faker.string.uuid() },
    snapshot: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    mergedByUserId: { required: true, fillable: false, validation: { rule: schema.number() }, factory: () => 1 },
  },
} as const)
