/**
 * The publications list, the rows it turns into, and the create body.
 *
 * A new publication is always a draft, and each status offers one forward
 * step. The page also claims that nothing serves a publication publicly;
 * a test holds that claim to the routes, so it is revisited when one does.
 */
import { describe, expect, test } from 'bun:test'
import {
  accessLabel,
  draftError,
  listErrorMessage,
  PUBLICATION_ACCESS,
  PUBLICATION_DESCRIPTION_MAX,
  PUBLICATION_NAME_MAX,
  PUBLICATION_STATUSES,
  publicationPayload,
  PUBLICATIONS_ENDPOINT,
  PUBLICATIONS_PER_PAGE,
  publicationsUrl,
  publicationUrl,
  saveErrorMessage,
  statusLabel,
  toPublicationView,
  toPublicationViews,
} from '../../resources/data/publications-query'

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

describe('the requests', () => {
  test('it lists from the endpoint the model publishes, by name then id', () => {
    expect(PUBLICATIONS_ENDPOINT).toBe('/api/v1/publications')
    expect(params(publicationsUrl())).toEqual({ per_page: String(PUBLICATIONS_PER_PAGE), sort: 'name,id' })
    expect(params(publicationsUrl({ status: 'active', page: 2 }))).toMatchObject({ status: 'active', page: '2' })
    expect(params(publicationsUrl({ status: '' }))).not.toHaveProperty('status')
    expect(publicationUrl(5)).toBe('/api/v1/publications/5')
  })

  test('the options are the model\'s own enums', async () => {
    const model = await Bun.file(new URL('../../app/Models/Publication.ts', import.meta.url)).text()
    expect(model).toContain(`schema.enum([${PUBLICATION_STATUSES.map(item => `'${item.value}'`).join(', ')}])`)
    expect(model).toContain(`schema.enum([${PUBLICATION_ACCESS.map(item => `'${item.value}'`).join(', ')}])`)
  })

  test('still true: no route serves a publication to the public', async () => {
    // When this fails, a publication's status has started to mean something
    // on the web, and the page's wording about it should be looked at again.
    const root = new URL('../../routes/', import.meta.url).pathname
    const files = await Array.fromAsync(new Bun.Glob('*.ts').scan({ cwd: root, absolute: true, onlyFiles: true }))
    for (const file of files)
      expect(await Bun.file(file).text()).not.toMatch(/publication/i)
  })
})

describe('a row on the list', () => {
  test('it shows the name, short name, access and status', () => {
    const view = toPublicationView({ id: 1, name: 'Sunday Paper', slug: 'sunday-paper', description: ' A weekly  letter. ', status: 'active', access: 'mixed', updated_at: '2026-11-10T09:00:00Z' }, 'en-US')
    expect(view).toMatchObject({ name: 'Sunday Paper', slug: 'sunday-paper', description: 'A weekly letter.', statusLabel: 'Active', accessLabel: 'Free and paid', updatedLabel: 'Nov 10, 2026' })
  })

  test('each status offers one forward step', () => {
    const step = (status: string) => {
      const view = toPublicationView({ id: 2, status })
      return [view.nextStatus, view.nextLabel, view.canArchive]
    }
    expect(step('draft')).toEqual(['active', 'Mark active', true])
    expect(step('paused')).toEqual(['active', 'Mark active', true])
    expect(step('active')).toEqual(['paused', 'Pause', true])
    // Back as a draft, never straight to active.
    expect(step('archived')).toEqual(['draft', 'Restore as draft', false])
    expect(step('odd')).toEqual(['', '', true])
  })

  test('labels cover the unknown and the missing', () => {
    expect(accessLabel('paid')).toBe('Paid')
    expect(accessLabel(null)).toBe('Unknown')
    expect(statusLabel('odd_one')).toBe('Odd one')
    expect(toPublicationView({ id: 3, name: ' ' })).toMatchObject({ name: 'Publication 3', status: 'draft', description: '' })
    expect(toPublicationViews(null)).toEqual([])
  })
})

describe('creating one', () => {
  test('a complete draft has no error, and the short name follows the name', () => {
    expect(draftError({ name: 'Sunday Paper' })).toBe('')
    expect(publicationPayload({ name: ' Sunday Paper ', access: 'paid', description: ' Weekly. ' })).toEqual({ name: 'Sunday Paper', slug: 'sunday-paper', access: 'paid', status: 'draft', description: 'Weekly.' })
  })

  test('it holds the fields to the model limits', () => {
    expect(draftError({ name: 'a' })).toContain('at least 2')
    expect(draftError({ name: 'n'.repeat(PUBLICATION_NAME_MAX + 1) })).toContain(`at most ${PUBLICATION_NAME_MAX}`)
    expect(draftError({ name: 'Sunday Paper', slug: 'Not A Slug' })).toContain('lowercase letters')
    expect(draftError({ name: 'Sunday Paper', slug: 's'.repeat(121) })).toContain('at most 120')
    expect(draftError({ name: '!!', slug: '' })).toContain('short name of at least 2')
    expect(draftError({ name: 'Sunday Paper', description: 'd'.repeat(PUBLICATION_DESCRIPTION_MAX + 1) })).toContain(`at most ${PUBLICATION_DESCRIPTION_MAX}`)
  })

  test('the body is always a draft, with free access unless a known one is chosen', () => {
    const payload = publicationPayload({ name: 'Field Notes', slug: 'notes', access: 'premium', description: ' ' })
    expect(payload).toEqual({ name: 'Field Notes', slug: 'notes', access: 'free', status: 'draft' })
    expect(payload).not.toHaveProperty('description')
  })
})

describe('what it says back', () => {
  test('each failure names what happened', () => {
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(503)).toContain('not answering')
    expect(listErrorMessage(418)).toContain('(418)')
    expect(saveErrorMessage(409)).toContain('already has a publication')
    expect(saveErrorMessage(422)).toContain('invalid')
    expect(saveErrorMessage(500)).toContain('(500)')
  })
})
