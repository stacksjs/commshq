import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import theme from '../../config/crosswind'
import stx from '../../stx.config'
// STX exposes its selected CSS engine through these installed files.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { SEMANTIC_TOKENS, SHAPE_TOKENS } from '../../node_modules/@stacksjs/stx/dist/theme-tokens.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const ROOT = join(import.meta.dir, '../..')
const PUBLIC = join(ROOT, 'public')
const colors: Record<string, string> = theme.theme.extend.colors

describe('component palette contract', () => {
  test('the palette has exactly one declaration site, and it is the config', () => {
    /*
     * This used to assert the opposite -- that stx.app.head.link carried
     * /component-tokens.css "on every page". It did, and that was the bug.
     *
     * That file declared the same seven names under `:where(:root)`, chosen so
     * it would LOSE to the editorial palette. Specificity was not what decided
     * it: the editorial palette is a preflight and lands in @layer tc-base,
     * while a linked stylesheet is unlayered, and an unlayered rule beats a
     * layered one at any specificity including zero. So it won everywhere and
     * the editorial palette reached no page -- measured on the built site at
     * --paper #f6f3ee against #f7f1ea light, #111210 against #191715 dark.
     *
     * It is deleted, and nothing may link a second copy back in.
     */
    const links = stx.app?.head?.link ?? []
    for (const link of links)
      expect({ href: (link as { href?: string }).href, isATokenSheet: /component-tokens|tokens\.css/.test((link as { href?: string }).href ?? '') })
        .toEqual({ href: (link as { href?: string }).href, isATokenSheet: false })
    expect(existsSync(join(ROOT, 'public/component-tokens.css'))).toBe(false)

    // §11.2's own check: no stylesheet under public/ declares a design token.
    const offenders = (existsSync(PUBLIC) ? readdirSync(PUBLIC) : [])
      .filter(name => name.endsWith('.css'))
      .filter(name => /^\s*--[a-z][\w-]*\s*:/m.test(readFileSync(join(PUBLIC, name), 'utf8')))
    expect(offenders).toEqual([])
  })

  test('the editorial values are the ones that reach the page', async () => {
    /*
     * The half the old test could not see. It checked that a <link> was
     * configured, never which values won once both sheets were on the page.
     */
    const engine = await loadCssEngine()
    if (!engine) throw new Error('The installed STX CSS engine is required')
    const merged = mergeCssConfig(engine.defaultConfig || engine.config, theme)
    const css = new engine.CSSGenerator(merged.config).toCSS(merged.includePreflight, false)
    for (const declaration of ['--paper:#f7f1ea', '--panel:#fffaf5', '--paper:#191715', '--panel:#24211e'])
      expect({ declaration, emitted: css.includes(declaration) }).toEqual({ declaration, emitted: true })
    // And the values component-tokens.css used are gone with it.
    for (const declaration of ['#f6f3ee', '#111210', '#1b1c1a'])
      expect({ declaration, stillPresent: css.includes(declaration) }).toEqual({ declaration, stillPresent: false })

    /*
     * The two names that existed ONLY in component-tokens.css. Fourteen
     * `colors` roles read them, so losing them in the deletion would have
     * resolved every success and danger utility to nothing.
     */
    for (const declaration of ['--comms-success:#466833', '--comms-danger:#8f3025', '--comms-success:#acd294', '--comms-danger:#ffab9a'])
      expect({ declaration, emitted: css.includes(declaration) }).toEqual({ declaration, emitted: true })
    const reading = Object.entries(colors).filter(([, value]) => /--comms-(success|danger)/.test(value))
    expect(reading.length).toBeGreaterThanOrEqual(14)
  })

  test('every component color and radius emits an app-owned utility', async () => {
    const engine = await loadCssEngine()
    if (!engine) throw new Error('The installed STX CSS engine is required')
    const generator = new engine.CSSGenerator(mergeCssConfig(engine.defaultConfig || engine.config, theme).config)
    for (const role of Object.keys(SEMANTIC_TOKENS)) generator.generate(`bg-${role}`)
    for (const role of Object.keys(SHAPE_TOKENS)) generator.generate(`rounded-${role}`)
    const css = generator.toCSS(false, false)
    expect(css).not.toContain('var(--stx-')
    for (const role of Object.keys(SEMANTIC_TOKENS)) expect(css).toContain(`.bg-${role} {`)
    for (const role of Object.keys(SHAPE_TOKENS)) expect(css).toContain(`.rounded-${role} {`)
    expect(css).toContain('.bg-content {\n  background-color: var(--panel);')
    expect(css).toContain('.bg-accent-solid {\n  background-color: var(--coral);')
    expect(css).toContain('.rounded-control {\n  border-radius: 10px;')
    expect(css).toContain('.rounded-panel {\n  border-radius: 12px;')
  })

  test('the quiet text scale collapses on purpose, because this palette has two steps', () => {
    /*
     * fg-soft is the one that matters: <Breadcrumb> paints separators with it
     * and links with fg-muted, so equal values mean a divider as loud as the
     * labels it divides. The other four HQ apps have a third text step and
     * point fg-soft at it; this palette has only --ink and --muted, so all three quiet
     * roles share one value.
     *
     * Pinned as a test so it reads as a decision. If a third step is ever
     * added, this fails and points at the four roles that should use it.
     */
    expect(colors['fg-strong']).toBe('var(--ink)')
    for (const role of ['fg-muted', 'fg-soft', 'fg-subtle'])
      expect(colors[role]).toBe('var(--muted)')
  })
})
