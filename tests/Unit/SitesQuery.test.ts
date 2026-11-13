/**
 * Link pages and landing pages.
 *
 * Three rules matter most. The page never writes `published`, because no
 * route serves a page; a test holds that claim to the code, so it is
 * revisited the day something does. A link typed by one member is shown to
 * the others, so only an http or https address may become an href. And the
 * database does not keep short names unique here, so the page asks first.
 */
import { describe, expect, test } from 'bun:test'
import {
  draftError,
  kindOf,
  LINK_LABEL_MAX,
  LINKS_MAX,
  listErrorMessage,
  NOT_SERVED,
  PAGE_KINDS,
  PAGE_STATUSES,
  pagePayload,
  PAGES_PER_PAGE,
  pagesUrl,
  pageUrl,
  parseLinks,
  saveErrorMessage,
  SETTABLE_STATUSES,
  slugCheckUrl,
  slugTaken,
  statusPayload,
  storedLinks,
  toPageView,
  toPageViews,
} from '../../resources/data/sites-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

async function sourcesUnder(pattern: string): Promise<string[]> {
  const root = new URL('../../', import.meta.url).pathname
  const files = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root, absolute: true, onlyFiles: true }))
  return Promise.all(files.map(file => Bun.file(file).text()))
}

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

describe('the requests', () => {
  test('each kind is listed from its own generated route, by name then id', () => {
    expect(PAGE_KINDS.map(kind => [kind.key, kind.endpoint])).toEqual([['link', '/api/v1/link-pages'], ['landing', '/api/v1/landing-pages']])
    expect(params(pagesUrl('link'))).toEqual({ per_page: String(PAGES_PER_PAGE), sort: 'title,id' })
    expect(params(pagesUrl('landing', { status: 'archived', page: 3 }))).toEqual({ page: '3', per_page: String(PAGES_PER_PAGE), status: 'archived', sort: 'name,id' })
    expect(pageUrl('landing', 7)).toBe('/api/v1/landing-pages/7')
    expect(kindOf('nonsense').key).toBe('link')
  })

  test('the models publish those routes behind auth and team', async () => {
    expect(await source('app/Models/LinkPage.ts')).toContain("useApi: { prefix: 'v1', uri: 'link-pages', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] }")
    expect(await source('app/Models/LandingPage.ts')).toContain("useApi: { prefix: 'v1', uri: 'landing-pages', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] }")
  })

  test('the filter offers each model\'s own statuses', async () => {
    for (const [kind, file] of [['link', 'LinkPage'], ['landing', 'LandingPage']] as const) {
      const model = await source(`app/Models/${file}.ts`)
      expect(model).toContain(`schema.enum([${PAGE_STATUSES[kind].map(item => `'${item.value}'`).join(', ')}])`)
    }
  })

  test('a short name is looked up before a save, and any row means taken', () => {
    expect(params(slugCheckUrl('link', 'links'))).toEqual({ slug: 'links', per_page: '1' })
    expect(slugCheckUrl('landing', 'a b').startsWith('/api/v1/landing-pages?')).toBe(true)
    expect(slugTaken({ data: [{ id: 1 }] })).toBe(true)
    for (const body of [{ data: [] }, {}, null, undefined])
      expect(slugTaken(body as any)).toBe(false)
  })

  test('still true: the index cannot keep short names unique for a page with no site', async () => {
    // The day the index stops including site_id, the lookup can go and a 409
    // can be trusted instead.
    for (const file of ['LinkPage', 'LandingPage'])
      expect(await source(`app/Models/${file}.ts`)).toContain("columns: ['team_id', 'site_id', 'slug'], unique: true")
    expect(await source('resources/components/CommsHQ/SitesWorkspace.stx')).toContain('slugCheckUrl(asked, payload.slug)')
  })
})

describe('publishing', () => {
  test('the page only ever writes draft and archived', () => {
    expect([...SETTABLE_STATUSES]).toEqual(['draft', 'archived'])
    expect(statusPayload('archived')).toEqual({ status: 'archived' })
    expect(statusPayload('draft')).toEqual({ status: 'draft' })
    for (const status of ['published', 'scheduled', '', 'Draft'])
      expect(statusPayload(status)).toBeNull()
    expect(pagePayload('link', { name: 'Links' }).status).toBe('draft')
    expect(pagePayload('landing', { name: 'Welcome' }).status).toBe('draft')
  })

  test('every row offers exactly one step, and it is never publish', () => {
    for (const status of ['draft', 'published', 'scheduled'])
      expect(toPageView('landing', { id: 1, name: 'A', status })).toMatchObject({ nextStatus: 'archived', nextLabel: 'Archive' })
    expect(toPageView('link', { id: 1, title: 'A', status: 'archived' })).toMatchObject({ nextStatus: 'draft', nextLabel: 'Restore as draft' })
    // A page some other client published is shown as what it is.
    expect(toPageView('link', { id: 1, title: 'A', status: 'published' }).statusLabel).toBe('Published')
  })

  test('still true: nothing serves a link page or a landing page', async () => {
    // The page says nothing here is on the web. The day a route, action or
    // view starts reading these tables, this fails and publishing can be
    // offered.
    const code = [
      ...await sourcesUnder('app/{Actions,Jobs,Support,Listeners,Middleware}/**/*.ts'),
      ...await sourcesUnder('routes/*.ts'),
      ...await sourcesUnder('resources/views/**/*.stx'),
    ].join('\n')
    expect(code).not.toMatch(/LinkPage\b|link_pages|link-pages|LandingPage\b|landing_pages|landing-pages/)
    expect(NOT_SERVED).toContain('cannot be published from here')
    expect(await source('resources/components/CommsHQ/SitesWorkspace.stx')).toContain('{{ notServed }}')
  })

  test('the seeder publishes nothing either', async () => {
    const seeder = await source('database/seeders/WorkspaceSitesSeeder.ts')
    expect(seeder).not.toMatch(/status: '(published|scheduled)'/)
    expect(seeder).toContain('isProductionEnv()')
  })
})

describe('links', () => {
  test('only an http or https address becomes a link', () => {
    const links = storedLinks(JSON.stringify([
      { label: 'Site', url: 'https://example.com/a' },
      { label: 'Script', url: 'javascript:alert(1)' },
      { label: 'Data', url: 'data:text/html,hi' },
      { label: '', url: 'http://example.org' },
      { label: 'No address' },
      null,
      'https://example.com',
    ]))
    expect(links).toEqual([
      { label: 'Site', url: 'https://example.com/a', host: 'example.com' },
      { label: 'example.org', url: 'http://example.org/', host: 'example.org' },
    ])
  })

  test('a column that is not a list of links is no links', () => {
    for (const value of ['', 'not json', '{"url":"https://example.com"}', null, undefined, 4])
      expect(storedLinks(value)).toEqual([])
  })

  test('the box takes one link per line, with or without a label', () => {
    expect(parseLinks('Newsletter | https://example.com/news\n\n  https://example.org  \nA | B | https://example.net')).toEqual({
      links: [
        { label: 'Newsletter', url: 'https://example.com/news' },
        { label: 'example.org', url: 'https://example.org/' },
        { label: 'A | B', url: 'https://example.net/' },
      ],
      error: '',
    })
    expect(parseLinks('')).toEqual({ links: [], error: '' })
  })

  test('a line that cannot be a link is reported by its number, and nothing is kept', () => {
    expect(parseLinks('https://example.com\nShop | javascript:alert(1)')).toEqual({ links: [], error: 'Line 2 needs a web address that starts with https:// or http://.' })
    expect(parseLinks('Shop | example.com').error).toContain('Line 1')
    expect(parseLinks(`${'x'.repeat(LINK_LABEL_MAX + 1)} | https://example.com`).error).toContain(`at most ${LINK_LABEL_MAX}`)
    const many = Array.from({ length: LINKS_MAX + 1 }, (_, index) => `https://example.com/${index}`).join('\n')
    expect(parseLinks(many).error).toContain(`at most ${LINKS_MAX} links`)
  })
})

describe('what the page shows and saves', () => {
  test('a link page row', () => {
    const view = toPageView('link', { id: 3, title: ' Find us ', slug: 'links', bio: 'A  weekly\nletter', status: 'draft', links: '[{"label":"Site","url":"https://example.com"}]' })
    expect(view).toMatchObject({ name: 'Find us', slug: 'links', statusLabel: 'Draft', detail: 'A weekly letter', linkSummary: '1 link', searchTitle: '' })
    expect(toPageView('link', { id: 4, links: '[]' })).toMatchObject({ name: 'Link page 4', linkSummary: '0 links', status: 'draft' })
  })

  test('a landing page row', () => {
    const view = toPageView('landing', { id: 5, name: 'Welcome', slug: 'welcome', status: 'archived', seo: '{"title":"Welcome to us","description":"What to expect."}' })
    expect(view).toMatchObject({ name: 'Welcome', searchTitle: 'Welcome to us', detail: 'What to expect.', linkSummary: '', links: [] })
    expect(toPageView('landing', { id: 6, name: 'Welcome', seo: '{"title":"Welcome"}' }).searchTitle).toBe('')
    expect(toPageView('landing', { id: 7, seo: 'not json' })).toMatchObject({ name: 'Landing page 7', detail: '' })
    expect(toPageViews('landing', null)).toEqual([])
  })

  test('a draft is checked against the models\' limits', () => {
    expect(draftError('link', { name: 'A' })).toContain('title of at least 2')
    expect(draftError('landing', { name: 'A' })).toContain('name of at least 2')
    expect(draftError('link', { name: 'x'.repeat(161) })).toContain('at most 160')
    expect(draftError('link', { name: 'Links', slug: 'My Links' })).toContain('lowercase letters, digits and hyphens')
    expect(draftError('link', { name: '!!!' })).toContain('short name of at least 2')
    expect(draftError('link', { name: 'Links', bio: 'x'.repeat(501) })).toContain('at most 500')
    expect(draftError('link', { name: 'Links', links: 'nope' })).toContain('Line 1')
    expect(draftError('landing', { name: 'Welcome', seoTitle: 'x'.repeat(71) })).toContain('search title')
    expect(draftError('landing', { name: 'Welcome', seoDescription: 'x'.repeat(161) })).toContain('search description')
    // A landing page ignores the link fields, and the other way round.
    expect(draftError('landing', { name: 'Welcome', links: 'nope' })).toBe('')
    expect(draftError('link', { name: 'Links', links: 'https://example.com' })).toBe('')
  })

  test('the JSON columns are sent as strings, which is what the API validates', () => {
    const link = pagePayload('link', { name: ' Find us everywhere ', bio: ' Hello ', links: 'Site | https://example.com', seoTitle: 'ignored' })
    expect(link).toEqual({
      title: 'Find us everywhere',
      slug: 'find-us-everywhere',
      links: '[{"label":"Site","url":"https://example.com/"}]',
      theme: '{"style":"editorial"}',
      status: 'draft',
      bio: 'Hello',
    })
    expect(pagePayload('link', { name: 'Links' })).not.toHaveProperty('bio')

    const landing = pagePayload('landing', { name: 'Reader welcome', slug: 'welcome', seoTitle: 'Hi', links: 'ignored' })
    expect(landing).toEqual({ name: 'Reader welcome', slug: 'welcome', document: '{"blocks":[]}', seo: '{"title":"Hi"}', status: 'draft' })
    expect(pagePayload('landing', { name: 'Reader welcome' }).seo).toBe('{}')
  })

  test('failures are explained by their status', () => {
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(503)).toContain('not answering')
    expect(saveErrorMessage(409)).toContain('already has a page of this kind')
    expect(saveErrorMessage(404)).toContain('no longer exists')
    expect(saveErrorMessage(418)).toContain('(418)')
  })

  test('the user-visible text has no em-dash or en-dash', async () => {
    const text = `${await source('resources/data/sites-query.ts')}${await source('resources/components/CommsHQ/SitesWorkspace.stx')}`
    expect(text).not.toMatch(/[—–]/)
  })
})
