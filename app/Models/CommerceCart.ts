import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A cart a connected store reported, one row per checkout.
 *
 * Written by `ProcessWebhookEvent` from Shopify's checkout webhooks, keyed
 * by the checkout's token, and moved along by `app/Support/commerceCarts.ts`:
 * `open` while the shopper is still at it, `abandoned` once it has been
 * quiet for an hour, `completed` when an order arrives for it first, and
 * `recovered` when the order arrives after it was abandoned.
 *
 * The buyer's address and the link back to the cart are hidden: the link
 * opens that shopper's cart, and both are for the email a cart automation
 * sends, not for the page.
 */
export default defineModel({
  name: 'CommerceCart', table: 'commerce_carts', belongsTo: ['Team', 'CommerceConnection', 'Contact'],
  indexes: [
    { name: 'commerce_carts_provider_unique', columns: ['commerce_connection_id', 'external_id'], unique: true },
    { name: 'commerce_carts_team_status_index', columns: ['team_id', 'status', 'last_activity_at'] },
  ],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'commerce-carts', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    externalId: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: faker => faker.string.uuid() },
    status: { required: true, fillable: false, default: 'open', validation: { rule: schema.string().max(16) }, factory: () => 'open' },
    email: { required: false, fillable: false, hidden: true, validation: { rule: schema.string().max(255) }, factory: faker => faker.internet.email() },
    recoveryUrl: { required: false, fillable: false, hidden: true, validation: { rule: schema.string().max(2048) }, factory: () => null },
    amount: { required: false, fillable: false, validation: { rule: schema.number().min(0) }, factory: faker => faker.number.int({ min: 1500, max: 24000 }) },
    currency: { required: false, fillable: false, default: 'USD', validation: { rule: schema.string().max(3) }, factory: () => 'USD' },
    itemCount: { required: false, fillable: false, validation: { rule: schema.number().min(0) }, factory: () => 1 },
    lastActivityAt: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
    abandonedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    closedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
