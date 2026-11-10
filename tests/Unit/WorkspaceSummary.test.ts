/**
 * The command center's figures, and the shapes they are read from.
 *
 * These assertions exist because the page they serve replaced invented
 * numbers, and the way that bug comes back is a formatter that quietly
 * substitutes something plausible for something missing. So the cases below
 * are mostly about absence: no response, no field, no allowance, no period
 * covering today. In each one the right answer is a zero or a stated absence,
 * never a guess.
 *
 * The money case is the sharpest. `Earning.netAmount` is stored in minor
 * units, so a formatter that reads it as major units prints a hundred times
 * the real figure, and it prints it in the one place on the dashboard a reader
 * would quote to somebody else.
 */
import { describe, expect, test } from 'bun:test'
import {
  formatCount,
  formatMoney,
  meterLabel,
  summaryErrorMessage,
  toCurrentMeters,
  toLibraryEntries,
  toPulseTiles,
  WORKSPACE_ENDPOINT,
  WORKSPACE_FALLBACK_NAME,
  workspaceName,
} from '../../resources/data/workspace-summary'

/** The response body the action returns for the seeded owner workspace. */
const SEEDED = {
  workspace: { id: 74, name: 'CommsHQ' },
  contacts: 18,
  campaigns: 0,
  publications: 0,
  activeRuns: 0,
  attributedRevenue: 0,
  library: { audiences: 4, segments: 5, templates: 6 },
  usage: [
    { key: 'emails', quantity: 0, included_quantity: 250000, period_start: '2026-11-01T00:00:00.000Z', period_end: '2026-12-01T00:00:00.000Z' },
    { key: 'contacts', quantity: 1200, included_quantity: 25000, period_start: '2026-11-01T00:00:00.000Z', period_end: '2026-12-01T00:00:00.000Z' },
    { key: 'sms_segments', quantity: 4, included_quantity: null, period_start: '2026-11-01T00:00:00.000Z', period_end: '2026-12-01T00:00:00.000Z' },
    { key: 'emails', quantity: 90, included_quantity: 250000, period_start: '2026-10-01T00:00:00.000Z', period_end: '2026-11-01T00:00:00.000Z' },
  ],
}

/** Inside the November period above, so `toCurrentMeters` has a window to pick. */
const DURING_NOVEMBER = new Date('2026-11-10T12:00:00.000Z')

describe('the endpoint it reads', () => {
  test('it asks the route that routes/api.ts already publishes', () => {
    expect(WORKSPACE_ENDPOINT).toBe('/api/v1/workspace')
  })
})

describe('naming the workspace', () => {
  test('it uses the name the endpoint returned', () => {
    expect(workspaceName(SEEDED)).toBe('CommsHQ')
  })

  test('it falls back to a neutral word rather than a company nobody owns', () => {
    // The page hard-coded "Sunday Paper Co." for every account. A fallback
    // that named any real-sounding business would be the same bug.
    expect(workspaceName(null)).toBe(WORKSPACE_FALLBACK_NAME)
    expect(workspaceName({ workspace: { name: '   ' } })).toBe(WORKSPACE_FALLBACK_NAME)
    expect(WORKSPACE_FALLBACK_NAME.toLowerCase()).not.toContain('co.')
  })
})

describe('formatting counts', () => {
  test('it groups thousands', () => {
    expect(formatCount(1200, 'en-US')).toBe('1,200')
  })

  test('a missing count is zero, not blank and not invented', () => {
    for (const value of [undefined, null, Number.NaN, 'nonsense' as unknown as number])
      expect(formatCount(value as number, 'en-US')).toBe('0')
  })
})

describe('formatting money', () => {
  test('it reads the column as minor units', () => {
    // 1846000 minor units is $18,460, which is what the old literal claimed.
    // Read as major units this would print $1,846,000.
    expect(formatMoney(1846000, 'en-US')).toBe('$18,460')
  })

  test('zero earnings print as zero', () => {
    expect(formatMoney(0, 'en-US')).toBe('$0')
    expect(formatMoney(undefined, 'en-US')).toBe('$0')
  })

  test('an unknown currency code does not throw', () => {
    // Intl throws on an invalid code rather than falling back, and a dashboard
    // tile must not be the thing that takes the page down.
    expect(formatMoney(1000, 'en-US', 'NOPE')).toContain('NOPE')
  })
})

describe('the pulse tiles', () => {
  test('all five are present and in a fixed order, whatever came back', () => {
    const keys = toPulseTiles(SEEDED).map(tile => tile.key)
    expect(keys).toEqual(['contacts', 'campaigns', 'publications', 'activeRuns', 'revenue'])
    // Same five for an empty response: a tile that vanishes at zero leaves the
    // reader unable to tell a zero from a field the endpoint stopped sending.
    expect(toPulseTiles(null).map(tile => tile.key)).toEqual(keys)
  })

  test('it shows the counts the endpoint supplied', () => {
    const tiles = toPulseTiles(SEEDED, 'en-US')
    expect(tiles[0]?.value).toBe('18')
    expect(tiles[0]?.label).toBe('Active contacts')
    expect(tiles[4]?.value).toBe('$0')
  })

  test('no tile carries a change figure, because no query produces one', () => {
    // The old tiles read "+18.4%", "99.1%", "+12.7%" and "3 need review". The
    // action performs counts and one sum; there is no previous period in it.
    for (const tile of toPulseTiles(SEEDED, 'en-US')) {
      expect(tile.note).not.toMatch(/%/)
      expect(tile.value).not.toMatch(/^[+-]/)
    }
  })

  test('an empty response reads as zero rather than as missing', () => {
    const tiles = toPulseTiles({}, 'en-US')
    expect(tiles.map(tile => tile.value)).toEqual(['0', '0', '0', '0', '$0'])
  })
})

describe('the usage meters', () => {
  test('it keeps only the period that contains the moment asked about', () => {
    const current = toCurrentMeters(SEEDED, DURING_NOVEMBER)
    expect(current).toHaveLength(3)
    // The October row is the same meter as a November one. Both would have put
    // "Emails" on the page twice.
    expect(current.filter(meter => meter.key === 'emails')).toHaveLength(1)
  })

  test('it sorts by label, since the endpoint orders by period and not by meter', () => {
    expect(toCurrentMeters(SEEDED, DURING_NOVEMBER).map(meter => meter.label))
      .toEqual(['Contacts', 'Emails', 'SMS segments'])
  })

  test('it reports usage as a percentage of the allowance', () => {
    const contacts = toCurrentMeters(SEEDED, DURING_NOVEMBER).find(meter => meter.key === 'contacts')
    expect(contacts?.percent).toBe(5)
    expect(contacts?.usedLabel).toBe('1,200')
    expect(contacts?.allowanceLabel).toBe('of 25,000')
  })

  test('a null allowance is recorded as absent, not as unlimited', () => {
    const sms = toCurrentMeters(SEEDED, DURING_NOVEMBER).find(meter => meter.key === 'sms_segments')
    // The column is null, which records no allowance. Printing "Unlimited"
    // would turn a gap in the data into permission to send forever.
    expect(sms?.percent).toBeNull()
    expect(sms?.included).toBeNull()
    expect(sms?.allowanceLabel.toLowerCase()).not.toContain('unlimited')
  })

  test('usage never exceeds the bar it is drawn in', () => {
    const over = toCurrentMeters({
      usage: [{ key: 'emails', quantity: 400000, included_quantity: 250000, period_start: '2026-11-01T00:00:00.000Z', period_end: '2026-12-01T00:00:00.000Z' }],
    }, DURING_NOVEMBER)
    expect(over[0]?.percent).toBe(100)
    // The real figure is still reported next to the bar.
    expect(over[0]?.usedLabel).toBe('400,000')
  })

  test('no period covering the moment yields nothing rather than last month', () => {
    expect(toCurrentMeters(SEEDED, new Date('2027-06-01T00:00:00.000Z'))).toEqual([])
    expect(toCurrentMeters(null)).toEqual([])
  })

  test('an unparseable period is dropped rather than shown undated', () => {
    expect(toCurrentMeters({ usage: [{ key: 'emails', quantity: 1, period_start: 'whenever', period_end: null }] }, DURING_NOVEMBER)).toEqual([])
  })

  test('a meter nobody has named still reads as itself', () => {
    expect(meterLabel('push_notifications')).toBe('Push notifications')
    expect(meterLabel(undefined)).toBe('Unknown meter')
  })
})

describe('the library panel', () => {
  test('it counts what the workspace holds', () => {
    const entries = toLibraryEntries(SEEDED, 'en-US')
    expect(entries.map(entry => [entry.label, entry.countLabel])).toEqual([
      ['Audiences', '4'],
      ['Segments', '5'],
      ['Message templates', '6'],
    ])
  })

  test('audiences link nowhere, because no page lists them', () => {
    const entries = toLibraryEntries(SEEDED)
    // `audience.stx` is the contacts table, so linking there would answer a
    // different question than the one the count asked.
    expect(entries.find(entry => entry.key === 'audiences')?.href).toBeUndefined()
    expect(entries.find(entry => entry.key === 'segments')?.href).toBe('/dashboard/commshq/segments')
    expect(entries.find(entry => entry.key === 'templates')?.href).toBe('/dashboard/commshq/editor')
  })

  test('a response with no library reads as three zeroes', () => {
    expect(toLibraryEntries(null).map(entry => entry.countLabel)).toEqual(['0', '0', '0'])
  })
})

describe('explaining a failure', () => {
  test('it separates an ended session from an account with no team', () => {
    expect(summaryErrorMessage(401)).toContain('Sign in again')
    expect(summaryErrorMessage(403)).toContain('not an active member')
    expect(summaryErrorMessage(403)).not.toContain('Sign in again')
  })

  test('it names the status it cannot explain', () => {
    expect(summaryErrorMessage(418)).toContain('418')
  })
})
