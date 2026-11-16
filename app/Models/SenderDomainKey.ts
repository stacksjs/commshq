import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'SenderDomainKey', table: 'sender_domain_keys', belongsTo: ['Team', 'SenderDomain'],
  indexes: [{ name: 'sender_domain_keys_domain_unique', columns: ['sender_domain_id'], unique: true }],
  // The DKIM key a sending domain's mail is signed with. The private half is
  // sealed under APP_KEY (app/Hq/sealed.ts) and hidden: it leaves this table
  // only to sign a message. `dkim_verified_at` is when the public half was
  // last seen in the domain's DNS, which is what an app's From line waits for.
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'sender-domain-keys', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    selector: { required: true, fillable: false, validation: { rule: schema.string().max(63) }, factory: () => 'commshq' },
    publicKey: { required: true, fillable: false, validation: { rule: schema.string() }, factory: () => '-----BEGIN PUBLIC KEY-----' },
    privateKeySealed: { required: true, fillable: false, guarded: true, hidden: true, validation: { rule: schema.string() }, factory: faker => faker.string.uuid() },
    dkimVerifiedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
