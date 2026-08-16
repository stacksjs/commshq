import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'MessageBlock', table: 'message_blocks', belongsTo: ['Team', 'MessageTemplate'],
  indexes: [{ name: 'message_blocks_template_position_index', columns: ['message_template_id', 'position'] }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'message-blocks', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    type: { required: true, fillable: true, validation: { rule: schema.enum(['heading', 'text', 'image', 'button', 'divider', 'product', 'columns', 'footer']) }, factory: () => 'text' },
    content: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({ text: 'Write something worth opening.' }) },
    styles: { required: false, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    position: { required: true, fillable: true, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    reusable: { required: true, fillable: true, default: false, validation: { rule: schema.boolean() }, factory: () => false },
  },
} as const)
