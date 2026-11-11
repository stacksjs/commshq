import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'
import { cycleName } from '../Support/seedNames'

/**
 * The five segments a new workspace starts with, one per seeded row.
 *
 * Walked by position rather than drawn: `segments_team_name_unique` spans
 * (team_id, name), and two segments called "Engaged readers" in one workspace
 * are a list nobody can tell apart. See `cycleName`.
 */
const SEGMENT_NAMES = ['Engaged readers', 'High intent shoppers', 'New this week', 'Needs a win-back', 'SMS opted in'] as const

let nameRow = 0

/*
 * `estimatedCount` seeds as zero, and `refreshedAt` as null, together.
 *
 * The factory used to draw a size between 80 and 6,800. Nothing in this
 * application evaluates a segment yet: there are no seeded rules, no snapshots
 * and no evaluator, so that number was a headcount nobody had counted, sitting
 * in a workspace of 36 contacts. A segment that has never been refreshed has
 * no size, and the two columns now say the same thing instead of
 * contradicting each other.
 */

export default defineModel({
  name: 'Segment', table: 'segments', belongsTo: ['Team'], hasMany: ['SegmentRule'],
  indexes: [{ name: 'segments_team_name_unique', columns: ['team_id', 'name'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'segments', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] }, useSeeder: { count: 5 } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(120) }, factory: () => cycleName(SEGMENT_NAMES, nameRow++) },
    description: { required: false, fillable: true, validation: { rule: schema.string().max(500) }, factory: faker => faker.company.catchPhrase() },
    matchType: { required: true, fillable: true, default: 'all', validation: { rule: schema.enum(['all', 'any']) }, factory: () => 'all' },
    estimatedCount: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    refreshedAt: { required: false, fillable: true, validation: { rule: schema.timestamp() }, factory: () => null },
  },
  dashboard: { highlight: true },
} as const)
