import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'IntegrationCredential', table: 'integration_credentials', belongsTo: ['Team'],
  indexes: [{ name: 'integration_credentials_team_provider_unique', columns: ['team_id', 'provider', 'name'], unique: true }],
  // Read-only here. Storing and removing go through the actions under
  // `Actions/Api/V1/Integrations`, which encrypt the value and require an
  // admin; the generated delete could be called by any member.
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'integration-credentials', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    provider: { required: true, fillable: false, validation: { rule: schema.enum(['twilio', 'stripe', 'shopify', 'woocommerce', 'mail', 'bedrock', 'yelp', 'google_business', 'generic']) }, factory: () => 'generic' },
    name: { required: true, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => 'Default connection' },
    encryptedValue: { required: true, fillable: false, guarded: true, hidden: true, encrypted: true, validation: { rule: schema.string() }, factory: faker => faker.string.uuid() },
    lastFour: { required: false, fillable: false, validation: { rule: schema.string().max(4) }, factory: () => null },
    rotatedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
