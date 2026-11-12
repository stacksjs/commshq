/**
 * The dashboard shell: the gate, the layout, and the navigation registry.
 *
 * Three of these are contracts no amount of looking at the page proves, which
 * is why they are pinned here rather than left to a manual check.
 *
 * The gate above all. `/dashboard/commshq/*` is a tree of stx views served by
 * path, not routes in a route file, so no `middleware('auth')` can reach them:
 * the only thing that gates them is `definePageMeta({ middleware: ['auth'] })`
 * read statically out of each page's source. A new page added without that
 * line is a signed-out-readable dashboard page, and it looks exactly like
 * every other page until someone visits it in a logged-out browser. There is
 * no runtime error to notice.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DASHBOARD_ROOT,
  dashboardLinkFor,
  dashboardLinks,
  dashboardSections,
} from '../../resources/data/dashboard-navigation'

const root = resolve(import.meta.dir, '../..')
const pagesDir = join(root, 'resources/views/dashboard/commshq')
const pages = readdirSync(pagesDir).filter(name => name.endsWith('.stx')).sort()
const source = (page: string): string => readFileSync(join(pagesDir, page), 'utf8')

/**
 * The template with its comments removed.
 *
 * Every grep-shaped check in this repo needs this, and for a reason worth
 * stating once: a comment that NAMES the shape being checked for satisfies the
 * grep, so the better a file documents its own decision, the more likely it is
 * to defeat the test guarding that decision. Both stx comment forms and the
 * `//` lines inside a script block.
 */
function markupOnly(value: string): string {
  return value
    .replace(/\{\{--[\s\S]*?--\}\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the dashboard is gated', () => {
  test('every page declares the auth middleware', () => {
    const ungated = pages.filter(page => !/definePageMeta\(\{\s*middleware:\s*\['auth'\]\s*\}\)/.test(source(page)))
    expect(ungated).toEqual([])
  })

  test('the gate is read statically, so it cannot be computed', () => {
    /*
     * stx parses the FIRST `definePageMeta({ ... })` call out of the source
     * before any script runs, and object literals only: a computed argument
     * returns null and the page is left ungated. So the declaration has to be
     * a literal, and it has to be the first one in the file.
     */
    for (const page of pages) {
      const first = source(page).indexOf('definePageMeta(')
      expect({ page, found: first >= 0 }).toEqual({ page, found: true })
      const call = source(page).slice(first, first + 60)
      expect(call).toContain(`definePageMeta({ middleware: ['auth'] })`)
    }
  })

  test('the pages this suite checks are the pages that exist', () => {
    // A filter that stopped matching would pass every assertion above by
    // checking nothing, which is the one failure a green test cannot show.
    expect(pages.length).toBe(20)
  })
})

describe('the dashboard shell', () => {
  const layout = readFileSync(join(root, 'resources/views/layouts/dashboard.stx'), 'utf8')

  test('every page extends it', () => {
    const wrong = pages.filter(page => !source(page).includes("@extends('dashboard')"))
    expect(wrong).toEqual([])
  })

  test('it is a whole document, which `default` was not', () => {
    // The layout these pages used before carried no <head> at all, so no
    // viewport meta and no appearance bootstrap reached a dashboard page.
    expect(layout).toContain('<!DOCTYPE html>')
    expect(layout).toContain('name="viewport"')
    expect(layout).toContain('@appearanceBootstrap(')
    expect(layout).toContain('@yield(\'title\')')
  })

  test('it keeps signed-in pages out of search indexes', () => {
    expect(layout).toMatch(/<meta name="robots" content="noindex[^"]*">/)
  })

  test('it leaves the main landmark to the page, and gives the skip link a target', () => {
    /*
     * Each of the thirteen page components opens its own <main>. A <main> here too
     * would give every dashboard page two main landmarks, so the layout wraps
     * the content in a div and the components carry `id="main"`.
     */
    expect(layout).toContain('href="#main"')
    // Markup, not prose: the layout's own comment explains why there is no
    // <main> here, and a grep that counts that mention is checking nothing.
    expect(markupOnly(layout)).not.toMatch(/<main\b/)
    for (const component of ['AudienceWorkspace', 'BillingWorkspace', 'CommandCenter', 'AutomationBuilder', 'CampaignComposer', 'DomainsWorkspace', 'FormsWorkspace', 'IntegrationsWorkspace', 'MessageStudio', 'ReputationWorkspace', 'SegmentsWorkspace', 'SendersWorkspace', 'WorkspaceSurface']) {
      const markup = markupOnly(readFileSync(join(root, `resources/components/CommsHQ/${component}.stx`), 'utf8'))
      expect({ component, mains: (markup.match(/<main\b/g) || []).length }).toEqual({ component, mains: 1 })
      expect(markup).toContain('<main id="main"')
    }
  })

  test('the content column clears the fixed rail at desktop width', () => {
    // The rail is `fixed` and 17rem wide, so nothing reserves that space for
    // it except this padding. Without the pair the content sits underneath it.
    const nav = readFileSync(join(root, 'resources/components/CommsHQ/DashboardNavigation.stx'), 'utf8')
    expect(nav).toContain('w-[17rem]')
    expect(layout).toContain('lg:pl-[17rem]')
  })
})

describe('the navigation registry', () => {
  test('every page is reachable from the sidebar', () => {
    const ids = new Set(dashboardLinks.map(item => item.id))
    const missing = pages.map(page => page.replace(/\.stx$/, '')).filter(id => !ids.has(id))
    expect(missing).toEqual([])
  })

  test('and the sidebar links to nothing that is not a page', () => {
    const onDisk = new Set(pages.map(page => page.replace(/\.stx$/, '')))
    const dangling = dashboardLinks.filter(item => !onDisk.has(item.id)).map(item => item.href)
    expect(dangling).toEqual([])
  })

  test('no id or href appears twice', () => {
    expect(new Set(dashboardLinks.map(item => item.id)).size).toBe(dashboardLinks.length)
    expect(new Set(dashboardLinks.map(item => item.href)).size).toBe(dashboardLinks.length)
    expect(new Set(dashboardSections.map(section => section.id)).size).toBe(dashboardSections.length)
  })

  test('the root page is the root path, not a child of it', () => {
    const index = dashboardLinks.find(item => item.id === 'index')
    expect(index?.href).toBe(DASHBOARD_ROOT)
  })

  test('every row carries an icon from the collection the app already uses', () => {
    for (const item of dashboardLinks)
      expect({ id: item.id, icon: item.icon }).toEqual({ id: item.id, icon: expect.stringMatching(/^i-hugeicons-[a-z0-9-]+$/) })
  })
})

describe('resolving the current row', () => {
  test('an exact page path selects that page', () => {
    expect(dashboardLinkFor(`${DASHBOARD_ROOT}/audience`)?.id).toBe('audience')
    expect(dashboardLinkFor(`${DASHBOARD_ROOT}/segments`)?.id).toBe('segments')
  })

  test('the root path selects the command center and not a child', () => {
    /*
     * The bug this guards: every href starts with the root, so a prefix match
     * in registry order would light up `index` on every page in the dashboard.
     * Longest href wins, which is why the resolver sorts.
     */
    expect(dashboardLinkFor(DASHBOARD_ROOT)?.id).toBe('index')
    expect(dashboardLinkFor(`${DASHBOARD_ROOT}/billing`)?.id).toBe('billing')
  })

  test('a trailing slash is the same page', () => {
    expect(dashboardLinkFor(`${DASHBOARD_ROOT}/audience/`)?.id).toBe('audience')
    expect(dashboardLinkFor(`${DASHBOARD_ROOT}/`)?.id).toBe('index')
  })

  test('a deeper path belongs to its section page', () => {
    // Nothing serves these yet; a contact detail page should not blank the rail.
    expect(dashboardLinkFor(`${DASHBOARD_ROOT}/audience/1842`)?.id).toBe('audience')
  })

  test('a path outside the dashboard selects nothing', () => {
    expect(dashboardLinkFor('/pricing')).toBeUndefined()
    expect(dashboardLinkFor('/')).toBeUndefined()
    // And the empty path a render outside any request scope reports.
    expect(dashboardLinkFor('')).toBeUndefined()
  })
})
