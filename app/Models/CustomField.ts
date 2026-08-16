import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'CustomField', table: 'custom_fields', belongsTo: ['Team'],
  indexes: [{ name: 'custom_fields_team_key_unique', columns: ['team_id', 'key'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'custom-fields', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(100) }, factory: () => 'Favorite topic' },
    key: { required: true, fillable: true, validation: { rule: schema.string().max(100) }, factory: faker => faker.lorem.slug() },
    type: { required: true, fillable: true, validation: { rule: schema.enum(['text', 'number', 'boolean', 'date', 'select', 'json']) }, factory: () => 'text' },
    options: { required: false, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify([]) },
  },
} as const)
