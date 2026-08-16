import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Recommendation',
  table: 'recommendations',
  belongsTo: ['Team', 'Publication'],
  indexes: [{ name: 'recommendations_partner_unique', columns: ['team_id', 'publication_id', 'partner_publication_id'], unique: true }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'recommendations', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
  },
  attributes: {
    partnerPublicationId: { required: true, fillable: true, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    direction: { required: true, fillable: true, validation: { rule: schema.enum(['outbound', 'inbound', 'exchange']) }, factory: () => 'exchange' },
    status: { required: true, fillable: true, default: 'pending', validation: { rule: schema.enum(['pending', 'active', 'paused', 'declined', 'ended']) }, factory: () => 'pending' },
    rewardAmount: { required: true, fillable: true, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    currency: { required: true, fillable: true, default: 'usd', validation: { rule: schema.string().max(3) }, factory: () => 'usd' },
    terms: { required: true, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
  },
} as const)
