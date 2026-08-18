import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'CampaignRecipient', table: 'campaign_recipients', belongsTo: ['Team', 'Campaign', 'Contact', 'CampaignVariant'],
  indexes: [{ name: 'campaign_recipients_unique', columns: ['campaign_id', 'contact_id'], unique: true }, { name: 'campaign_recipients_team_status', columns: ['team_id', 'status'] }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'campaign-recipients', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    channel: { required: true, fillable: false, validation: { rule: schema.enum(['email', 'sms']) } },
    addressHash: { required: true, fillable: false, hidden: true, validation: { rule: schema.string().max(128) } },
    status: { required: true, fillable: false, default: 'queued', validation: { rule: schema.enum(['queued', 'sent', 'delivered', 'failed', 'suppressed', 'cancelled']) } },
    idempotencyKey: { required: true, fillable: false, hidden: true, validation: { rule: schema.string().max(128) } },
    snapshot: { required: true, fillable: false, validation: { rule: schema.json() } },
    // Explicit `type`: the timestamp validator infers a numeric column while
    // the generator emits TEXT and every write here is an ISO string.
    scheduledAt: { type: 'string', required: false, fillable: false, validation: { rule: schema.timestamp() } },
  },
  dashboard: { section: 'marketing', icon: 'i-hugeicons-mail-send-02' },
} as const)
