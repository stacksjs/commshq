/**
 * Distinct names for seeded rows.
 *
 * Three models (`Audience`, `Segment`, `MessageTemplate`) each carry a unique
 * index on (team_id, name) and each drew their name with
 * `faker.helpers.arrayElement`, which draws WITH replacement. That was
 * invisible for as long as every seeded row was owned by nobody: the index
 * spans the team column, so rows with a null `team_id` never collided whatever
 * their name. The moment one workspace claims them the index becomes
 * reachable, and a seed run that had worked for months fails on the second
 * "Product updates".
 *
 * It was always a latent bug rather than one this change introduced. Two
 * audiences called "Product updates" in one workspace are not data anybody
 * wants; they are a list the reader cannot tell apart, and
 * `audiences_team_name_unique` exists to say so.
 *
 * Each of the three models offers a list exactly as long as its own
 * `useSeeder.count` (4 names for 4 audiences, 5 for 5 segments, 6 for 6
 * templates), so walking the list by row position gives one of each with no
 * suffix and no collision. The suffix below only matters if a count is later
 * raised past its list, where a second pass produces "Weekly readers 2"
 * rather than a failed insert.
 */

/**
 * The name for one row, by its position in the batch.
 *
 * `row` is 0-based. A numeric suffix rather than the seeder's own
 * disambiguation, which appends a space and a digit to any attribute declared
 * `unique` and would be both unreachable here (these attributes are not
 * declared unique; the index is on the table) and wrong for an address-shaped
 * value. Here the value is a label a person reads, so a trailing " 2" is
 * exactly what they would have typed themselves.
 */
export function cycleName(names: readonly string[], row: number): string {
  const position = Math.max(0, Math.trunc(row))
  if (names.length === 0)
    return `Untitled ${position + 1}`

  const name = names[position % names.length] as string
  const pass = Math.floor(position / names.length)
  return pass === 0 ? name : `${name} ${pass + 1}`
}
