import { describe, expect, test } from 'bun:test'
import { contactTimeline } from '../../database/seeders/WorkspaceContactsSeeder'

/*
 * The seeded audience is the only data the contacts page has to show, so the
 * shape of it is worth pinning. Every assertion here is about a property a
 * reader of the page would notice if it broke, not about the arithmetic:
 * a status filter with nothing behind an option, a "last seen" date that
 * precedes the row existing, or a sort key that cannot order the rows.
 *
 * `contactTimeline` is exported for exactly this - it is the whole decision,
 * and it is pure, so it can be checked without a database or a seed run.
 */

const SEEDED_COUNT = 36

function timelines(total: number) {
  return Array.from({ length: total }, (_, index) => contactTimeline(index, total))
}

describe('seeded contact timeline', () => {
  test('every status the page can filter by has rows behind it', () => {
    const counts = new Map<string, number>()
    for (const row of timelines(SEEDED_COUNT))
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1)

    // The page's filter offers exactly these five, from the model's enum.
    expect([...counts.keys()].sort()).toEqual(['active', 'archived', 'pending', 'suppressed', 'unsubscribed'])
    expect(counts.get('active')).toBe(18)
    expect(counts.get('pending')).toBe(6)
    expect(counts.get('unsubscribed')).toBe(6)
    expect(counts.get('suppressed')).toBe(3)
    expect(counts.get('archived')).toBe(3)
  })

  test('created_at is distinct per row, so -created_at can order them', () => {
    const created = timelines(SEEDED_COUNT).map(row => row.createdAt)
    expect(new Set(created).size).toBe(SEEDED_COUNT)
  })

  test('the batch runs oldest first', () => {
    const created = timelines(SEEDED_COUNT).map(row => Date.parse(row.createdAt))
    const ascending = [...created].sort((a, b) => a - b)
    expect(created).toEqual(ascending)
  })

  test('nobody engaged before the row that holds them existed', () => {
    for (const row of timelines(SEEDED_COUNT)) {
      if (row.lastEngagedAt === null) continue
      expect(Date.parse(row.lastEngagedAt)).toBeGreaterThanOrEqual(Date.parse(row.createdAt))
    }
  })

  test('nobody engaged in the future', () => {
    const now = Date.now()
    for (const row of timelines(SEEDED_COUNT)) {
      expect(Date.parse(row.createdAt)).toBeLessThanOrEqual(now)
      if (row.lastEngagedAt !== null)
        expect(Date.parse(row.lastEngagedAt)).toBeLessThanOrEqual(now)
    }
  })

  test('pending contacts have never engaged, and everyone else has', () => {
    for (const row of timelines(SEEDED_COUNT)) {
      if (row.status === 'pending')
        expect(row.lastEngagedAt).toBeNull()
      else
        expect(row.lastEngagedAt).not.toBeNull()
    }
  })

  /*
   * The statuses used to be read straight off the row's position, which also
   * set its age, so the churned statuses sat at the end of the cycle AND at
   * the recent end of the timeline: the page sorts newest first, so it opened
   * on nothing but people who had already left. The stride fixed that, and
   * this is the assertion that keeps it fixed.
   */
  test('the newest rows are not all churned', () => {
    const newest = timelines(SEEDED_COUNT).slice(-10).map(row => row.status)
    expect(newest.filter(status => status === 'active').length).toBeGreaterThan(0)
    expect(new Set(newest).size).toBeGreaterThan(2)
  })

  test('a single claimed row still gets a usable timeline', () => {
    const [only] = timelines(1)
    expect(only).toBeDefined()
    expect(Number.isNaN(Date.parse(only!.createdAt))).toBe(false)
    expect(only!.status).toBe('active')
  })

  test('the spread holds at other batch sizes', () => {
    for (const total of [12, 25, 60, 120]) {
      const rows = timelines(total)
      expect(new Set(rows.map(row => row.createdAt)).size).toBe(total)
      expect(new Set(rows.map(row => row.status)).size).toBe(5)
      for (const row of rows) {
        if (row.lastEngagedAt !== null)
          expect(Date.parse(row.lastEngagedAt)).toBeGreaterThanOrEqual(Date.parse(row.createdAt))
      }
    }
  })
})
