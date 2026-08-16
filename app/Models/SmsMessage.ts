import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'SmsMessage',
  table: 'sms_messages',
  belongsTo: ['Team', 'Campaign', 'SenderIdentity'],
  indexes: [{ name: 'sms_messages_team_campaign_index', columns: ['team_id', 'campaign_id'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'sms-messages', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
  },
  attributes: {
    body: { required: true, fillable: true, validation: { rule: schema.string().max(1600) }, factory: () => 'A useful update. Reply STOP to opt out.' },
    encoding: { required: true, fillable: false, default: 'gsm7', validation: { rule: schema.enum(['gsm7', 'ucs2']) }, factory: () => 'gsm7' },
    segmentCount: { required: true, fillable: false, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    stopLanguageIncluded: { required: true, fillable: false, default: true, validation: { rule: schema.boolean() }, factory: () => true },
    quietHoursTimezone: { required: true, fillable: true, default: 'recipient', validation: { rule: schema.string().max(100) }, factory: () => 'recipient' },
    revision: { required: true, fillable: false, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
  },
} as const)
