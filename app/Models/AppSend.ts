import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AppSend', table: 'app_sends', belongsTo: ['Team', 'ConnectedApp'],
  // The same idempotency key from the same app is the same message.
  indexes: [
    { name: 'app_sends_idempotency_unique', columns: ['connected_app_id', 'idempotency_key'], unique: true },
    { name: 'app_sends_team_created_index', columns: ['team_id', 'created_at'] },
  ],
  // What a connected app sent through `POST /api/v1/send`. Written by the
  // send itself, so read-only here.
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'app-sends', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    idempotencyKey: { required: false, fillable: false, validation: { rule: schema.string().max(200) }, factory: () => null },
    fromAddress: { required: true, fillable: false, validation: { rule: schema.string().max(400) }, factory: () => 'My app <noreply@example.com>' },
    authenticated: { required: true, fillable: false, validation: { rule: schema.enum(['domain', 'fallback']) }, factory: () => 'fallback' },
    status: { required: true, fillable: false, validation: { rule: schema.enum(['sent', 'failed']) }, factory: () => 'sent' },
    recipients: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify([]) },
    suppressed: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify([]) },
    // How many addresses the message went to: what volume limits count.
    recipientCount: { required: false, fillable: false, validation: { rule: schema.number().min(0) }, factory: () => 1 },
    subject: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: () => 'Hello' },
  },
} as const)
