import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ContactFieldValue',
  table: 'contact_field_values',
  belongsTo: ['Team', 'Contact', 'CustomField'],
  indexes: [
    { name: 'contact_field_values_unique', columns: ['team_id', 'contact_id', 'custom_field_id'], unique: true },
  ],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'contact-field-values', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
  },
  attributes: {
    value: { required: false, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify(null) },
  },
} as const)
