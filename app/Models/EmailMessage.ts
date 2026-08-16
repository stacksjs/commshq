import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'EmailMessage',
  table: 'email_messages',
  belongsTo: ['Team', 'Campaign', 'MessageTemplate', 'SenderIdentity'],
  indexes: [{ name: 'email_messages_team_campaign_index', columns: ['team_id', 'campaign_id'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'email-messages', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
  },
  attributes: {
    subject: { required: true, fillable: true, validation: { rule: schema.string().max(255) }, factory: () => 'A note worth opening' },
    preheader: { required: false, fillable: true, validation: { rule: schema.string().max(255) }, factory: () => null },
    fromName: { required: true, fillable: true, validation: { rule: schema.string().max(120) }, factory: () => 'CommsHQ' },
    fromAddress: { required: true, fillable: true, validation: { rule: schema.string().email().max(255) }, factory: () => 'hello@commshq.org' },
    replyTo: { required: false, fillable: true, validation: { rule: schema.string().email().max(255) }, factory: () => null },
    document: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({ blocks: [] }) },
    html: { required: false, fillable: false, validation: { rule: schema.string() }, factory: () => null },
    text: { required: false, fillable: false, validation: { rule: schema.string() }, factory: () => null },
    revision: { required: true, fillable: false, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
  },
} as const)
