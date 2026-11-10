import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'
import { cycleName } from '../Support/seedNames'

/**
 * The four lists a new workspace recognizes, one per seeded row.
 *
 * Walked by position rather than drawn, because `audiences_team_name_unique`
 * spans (team_id, name) and a random draw repeats. See `cycleName`.
 */
const AUDIENCE_NAMES = ['Weekly readers', 'Store customers', 'VIP members', 'Product updates'] as const

let nameRow = 0

export default defineModel({
  name: 'Audience', table: 'audiences', belongsTo: ['Team'], hasMany: ['AudienceMembership'],
  indexes: [{ name: 'audiences_team_name_unique', columns: ['team_id', 'name'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'audiences', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] }, useSeeder: { count: 4 } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(120) }, factory: () => cycleName(AUDIENCE_NAMES, nameRow++) },
    description: { required: false, fillable: true, validation: { rule: schema.string().max(500) }, factory: faker => faker.company.catchPhrase() },
    channel: { required: true, fillable: true, default: 'all', validation: { rule: schema.enum(['all', 'email', 'sms']) }, factory: () => 'all' },
    memberCount: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
  },
} as const)
