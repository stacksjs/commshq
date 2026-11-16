import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'HqConnectCode', table: 'hq_connect_codes', belongsTo: ['Team'],
  indexes: [{ name: 'hq_connect_codes_code_hash_unique', columns: ['code_hash'], unique: true }],
  // The pending and approved connects of `buddy hq:connect commshq`. The rows
  // are read and written by `sqlConnectCodeStore` from `@stacksjs/hq/service`,
  // by these column names: this model exists so the table's migration is
  // generated like every other. No secret is at rest in it: `code_hash` is the
  // SHA-256 of the code the CLI holds, and `sealed_grant` is the keys encrypted
  // under a key derived from that code. A code belongs to no team until it is
  // approved, so `team_id` stays empty and the generated API lists none of them.
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'hq-connect-codes', routes: ['index'], middleware: ['auth', 'team'] } },
  attributes: {
    codeHash: { required: true, fillable: false, guarded: true, hidden: true, validation: { rule: schema.string().max(64) }, factory: faker => faker.string.uuid() },
    app: { required: true, fillable: false, validation: { rule: schema.string().max(64) }, factory: () => 'app' },
    status: { required: true, fillable: false, validation: { rule: schema.string().max(16) }, factory: () => 'pending' },
    sealedGrant: { required: false, fillable: false, guarded: true, hidden: true, validation: { rule: schema.string() }, factory: () => null },
    claim: { required: false, fillable: false, hidden: true, validation: { rule: schema.string().max(36) }, factory: () => null },
    // Milliseconds since the epoch, so a bigint column.
    expiresAt: { required: true, fillable: false, validation: { rule: schema.unix() }, factory: () => Date.now() },
  },
} as const)
