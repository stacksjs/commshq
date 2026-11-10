/**
 * Distinct names for seeded rows.
 *
 * `Audience`, `Segment` and `MessageTemplate` each carry a unique index on
 * (team_id, name) and each drew their name with `faker.helpers.arrayElement`,
 * which draws WITH replacement. The collision was invisible for as long as
 * every seeded row had a null `team_id`, because the index spans that column.
 * Claiming those rows for a workspace made it reachable, and the seeded data
 * at the time proved it: 4 audiences held 2 distinct names, 5 segments held 4,
 * 6 templates held 4.
 *
 * So these tests are about the property the index needs, not about the words.
 */
import { describe, expect, test } from 'bun:test'
import { cycleName } from '../../app/Support/seedNames'

/** The three lists the models declare, with the count each one is seeded at. */
const LISTS = [
  { label: 'audiences', names: ['Weekly readers', 'Store customers', 'VIP members', 'Product updates'], count: 4 },
  { label: 'segments', names: ['Engaged readers', 'High intent shoppers', 'New this week', 'Needs a win-back', 'SMS opted in'], count: 5 },
  { label: 'templates', names: ['Sunday dispatch', 'Product drop', 'Founder note', 'Order follow-up', 'Event invite', 'Weekly edit'], count: 6 },
]

function walk(names: readonly string[], rows: number): string[] {
  return Array.from({ length: rows }, (_unused, row) => cycleName(names, row))
}

describe('walking a list by row', () => {
  test.each(LISTS)('$label get one of each, with no suffix', ({ names, count }) => {
    const produced = walk(names, count)
    expect(new Set(produced).size).toBe(count)
    // Each list is exactly as long as its own useSeeder.count, so a full pass
    // is one of each and nothing needs disambiguating.
    expect([...produced].sort()).toEqual([...names].sort())
    for (const name of produced)
      expect(name).not.toMatch(/\s\d+$/)
  })

  test('names stay unique past the end of the list', () => {
    // The guard for the day a count is raised: a second pass must not repeat.
    const produced = walk(['One', 'Two'], 6)
    expect(produced).toEqual(['One', 'Two', 'One 2', 'Two 2', 'One 3', 'Two 3'])
    expect(new Set(produced).size).toBe(6)
  })

  test('the same row always gives the same name', () => {
    // Positional, not drawn, so a reseed reproduces the same workspace and a
    // surprising row stays reproducible.
    expect(cycleName(LISTS[0]!.names, 2)).toBe(cycleName(LISTS[0]!.names, 2))
  })

  test('a suffix is a number, not the seeder’s own space-and-digit', () => {
    /*
     * The framework disambiguates an attribute declared `unique` by appending
     * " 2" to the value. That never ran here (the uniqueness is an index on
     * the table, not an attribute flag), and it is the wrong shape for an
     * address, which is why Contact numbers its emails instead. For a label a
     * person reads, a trailing number is exactly what they would have typed.
     */
    expect(cycleName(['Weekly readers'], 1)).toBe('Weekly readers 2')
  })

  test('an empty list still yields something unique rather than an empty name', () => {
    // `name` is a required column on all three models, so a blank would be a
    // failed insert with nothing to point at.
    expect(walk([], 3)).toEqual(['Untitled 1', 'Untitled 2', 'Untitled 3'])
  })

  test('a nonsense row index does not produce a nonsense name', () => {
    expect(cycleName(['One', 'Two'], -5)).toBe('One')
    expect(cycleName(['One', 'Two'], 1.7)).toBe('Two')
  })
})
