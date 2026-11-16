import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AppKey', table: 'app_keys', belongsTo: ['Team', 'ConnectedApp'],
  indexes: [{ name: 'app_keys_key_hash_unique', columns: ['key_hash'], unique: true }],
  // A key is never kept: `key_hash` is its SHA-256 (app/Hq/keys.ts), and it is
  // hidden so the hash does not travel either. `hint` is the start of the key,
  // to tell keys apart in a list. Read-only here: keys are issued by a connect.
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'app-keys', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    kind: { required: true, fillable: false, validation: { rule: schema.enum(['send', 'read']) }, factory: () => 'send' },
    keyHash: { required: true, fillable: false, guarded: true, hidden: true, validation: { rule: schema.string().max(64) }, factory: faker => faker.string.uuid() },
    hint: { required: true, fillable: false, validation: { rule: schema.string().max(32) }, factory: () => 'chq_send_abcde...' },
    createdBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
    lastUsedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    revokedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
