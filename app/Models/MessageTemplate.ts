import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'MessageTemplate', table: 'message_templates', belongsTo: ['Team'], hasMany: ['MessageBlock'],
  indexes: [{ name: 'message_templates_team_name_unique', columns: ['team_id', 'name'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'message-templates', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] }, useSeeder: { count: 6 } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(120) }, factory: faker => faker.helpers.arrayElement(['Sunday dispatch', 'Product drop', 'Founder note', 'Order follow-up', 'Event invite', 'Weekly edit']) },
    channel: { required: true, fillable: true, validation: { rule: schema.enum(['email', 'sms', 'landing_page']) }, factory: () => 'email' },
    subject: { required: false, fillable: true, validation: { rule: schema.string().max(255) }, factory: faker => faker.lorem.sentence(5) },
    document: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({ version: 1, blocks: [] }) },
    plainText: { required: false, fillable: true, validation: { rule: schema.string() }, factory: faker => faker.lorem.paragraph() },
    revision: { required: true, fillable: false, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
  },
  dashboard: { highlight: true },
} as const)
