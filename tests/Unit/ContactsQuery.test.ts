/**
 * The contacts listing request, and the rows it turns into.
 *
 * These assertions are written against what `@stacksjs/orm`'s route generator
 * actually does, not against the OpenAPI document, which declares none of
 * these parameters. The generator reserves a fixed set of names (`page`,
 * `per_page`, `sort`, `fields`, `search`, `include`, `limit`, `offset`,
 * `with_count`, `withTrashed`, `onlyTrashed`) and turns EVERY OTHER parameter
 * that names a real column into an equality filter. Two consequences this file
 * pins down:
 *
 *   - `status` is a filter because `status` is a column, with no filter syntax
 *     involved. If the parameter were ever renamed, these tests say so.
 *   - an empty value must not be sent. The generator skips a blank today
 *     (`if (M.has(x) || !v) continue`), so a stray `status=` is harmless by
 *     luck rather than by design, and the next parameter the page adds may not
 *     be as lucky.
 */
import { describe, expect, test } from 'bun:test'
import {
  CONTACTS_ENDPOINT,
  CONTACTS_PER_PAGE,
  CONTACT_STATUSES,
  contactsUrl,
  formatSeen,
  listErrorMessage,
  statusLabel,
  toContactView,
  toContactViews,
} from '../../resources/data/contacts-query'

/** The query half of a built URL, as a plain object. */
function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

describe('building the listing request', () => {
  test('it asks the endpoint the model publishes', () => {
    expect(contactsUrl().startsWith(`${CONTACTS_ENDPOINT}?`)).toBe(true)
  })

  test('the default request is page one, newest first', () => {
    expect(params(contactsUrl())).toEqual({
      per_page: String(CONTACTS_PER_PAGE),
      sort: '-created_at',
    })
  })

  test('page one is left implicit and later pages are not', () => {
    expect(params(contactsUrl({ page: 1 })).page).toBeUndefined()
    expect(params(contactsUrl({ page: 4 })).page).toBe('4')
  })

  test('a nonsense page falls back to the first one', () => {
    expect(params(contactsUrl({ page: 0 })).page).toBeUndefined()
    expect(params(contactsUrl({ page: -3 })).page).toBeUndefined()
    expect(params(contactsUrl({ page: 2.7 })).page).toBe('2')
  })

  test('an empty search or status is not sent at all', () => {
    const query = params(contactsUrl({ search: '   ', status: '' }))
    expect(query.search).toBeUndefined()
    expect(query.status).toBeUndefined()
  })

  test('a search term is trimmed and sent', () => {
    expect(params(contactsUrl({ search: '  maya  ' })).search).toBe('maya')
  })

  test('a status is sent as the plain column filter the generator expects', () => {
    expect(params(contactsUrl({ status: 'suppressed' })).status).toBe('suppressed')
  })

  test('a term with URL-significant characters survives encoding', () => {
    // An email search is the common case, and `+` is a legal local-part
    // character that a naive concatenation would deliver as a space.
    const url = contactsUrl({ search: 'a+b@example.com' })
    expect(params(url).search).toBe('a+b@example.com')
    expect(url).not.toContain('a+b@example.com')
  })

  test('sort names the column, not the attribute', () => {
    // Model attributes are camelCase; `sort` is resolved against columns.
    expect(params(contactsUrl()).sort).toBe('-created_at')
  })
})

describe('turning a row into something readable', () => {
  test('a full row reads as a person', () => {
    expect(toContactView({
      id: 7,
      email: 'maya@example.com',
      first_name: 'Maya',
      last_name: 'Alvarez',
      status: 'active',
      source: 'referral',
      last_engaged_at: '2026-03-04T10:00:00.000Z',
    }, 'en-US')).toEqual({
      id: 7,
      name: 'Maya Alvarez',
      address: 'maya@example.com',
      source: 'referral',
      status: 'active',
      statusLabel: 'Active',
      lastSeen: 'Mar 4, 2026',
    })
  })

  test('a contact with only a phone number is reachable and named by it', () => {
    const view = toContactView({ id: 9, phone: '+14155550184', status: 'pending' })
    expect(view.address).toBe('+14155550184')
    expect(view.name).toBe('+14155550184')
  })

  test('a contact with one name is not given a trailing space', () => {
    expect(toContactView({ id: 3, email: 'p@example.com', first_name: 'Priya' }).name).toBe('Priya')
    expect(toContactView({ id: 4, email: 'c@example.com', last_name: 'Chen' }).name).toBe('Chen')
  })

  test('a contact with nothing at all is still identifiable', () => {
    // Every column but the id is nullable on this model, and a blank row in a
    // table is worse than one that admits what it is.
    expect(toContactView({ id: 42 })).toEqual({
      id: 42,
      name: 'Contact 42',
      address: '',
      source: 'Unknown',
      status: '',
      statusLabel: 'Unknown',
      lastSeen: '-',
    })
  })

  test('an unrecognised status is shown rather than hidden', () => {
    // The enum can grow in the model before this list hears about it.
    expect(statusLabel('quarantined')).toBe('quarantined')
    expect(statusLabel(null)).toBe('Unknown')
  })

  test('every status the model declares has words of its own', () => {
    expect(CONTACT_STATUSES.map(item => item.value)).toEqual([
      'active',
      'pending',
      'unsubscribed',
      'suppressed',
      'archived',
    ])
    for (const item of CONTACT_STATUSES)
      expect(statusLabel(item.value)).toBe(item.label)
  })

  test('no engagement, and an unparseable date, both read as absent', () => {
    expect(formatSeen(null)).toBe('-')
    expect(formatSeen('')).toBe('-')
    expect(formatSeen('not a date')).toBe('-')
  })

  test('the placeholder is a hyphen, which the house rule requires', () => {
    // An em-dash here would be a pre-flight failure, and this value reaches
    // a table cell a reader sees.
    expect(formatSeen(null)).not.toMatch(/[—–]/)
  })

  test('a body with no rows is an empty list, not a crash', () => {
    expect(toContactViews(null)).toEqual([])
    expect(toContactViews(undefined)).toEqual([])
    expect(toContactViews({})).toEqual([])
    expect(toContactViews({ data: [] })).toEqual([])
  })

  test('a whole response maps in order', () => {
    const views = toContactViews({ data: [{ id: 1, email: 'a@example.com' }, { id: 2, email: 'b@example.com' }] })
    expect(views.map(view => view.id)).toEqual([1, 2])
  })
})

describe('explaining a refusal', () => {
  test('401 and 403 are different problems and say so', () => {
    /*
     * The page gate has already proved there is a session before any of this
     * runs, so a 403 from the team middleware is not "sign in again": it means
     * the account is in no active team. Telling someone to sign in again would
     * send them round a loop that cannot fix it.
     */
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(403)).toContain('workspace')
    expect(listErrorMessage(403)).not.toContain('Sign in again')
  })

  test('a rate limit says to wait, because the retry is the fix', () => {
    expect(listErrorMessage(429)).toContain('Wait')
  })

  test('a server fault does not blame the reader', () => {
    expect(listErrorMessage(500)).toContain('API')
    expect(listErrorMessage(503)).toContain('API')
  })

  test('an unexpected status still carries the number', () => {
    expect(listErrorMessage(418)).toContain('418')
  })

  test('no message uses the punctuation the house rule bans', () => {
    for (const status of [401, 403, 429, 500, 503, 418])
      expect(listErrorMessage(status)).not.toMatch(/[—–]/)
  })
})
