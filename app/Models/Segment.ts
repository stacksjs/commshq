import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Segment', table: 'segments', belongsTo: ['Team'], hasMany: ['SegmentRule'],
  indexes: [{ name: 'segments_team_name_unique', columns: ['team_id', 'name'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'segments', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] }, useSeeder: { count: 5 } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(120) }, factory: faker => faker.helpers.arrayElement(['Engaged readers', 'High intent shoppers', 'New this week', 'Needs a win-back', 'SMS opted in']) },
    description: { required: false, fillable: true, validation: { rule: schema.string().max(500) }, factory: faker => faker.company.catchPhrase() },
    matchType: { required: true, fillable: true, default: 'all', validation: { rule: schema.enum(['all', 'any']) }, factory: () => 'all' },
    estimatedCount: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: faker => faker.number.int({ min: 80, max: 6800 }) },
    refreshedAt: { required: false, fillable: true, validation: { rule: schema.timestamp() }, factory: () => null },
  },
  dashboard: { highlight: true },
} as const)
