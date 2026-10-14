import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import theme from '../../config/crosswind'
// The installed STX package does not export these subpaths by bare specifier.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const nav = readFileSync(join(import.meta.dir, '../../resources/components/CommsHQ/MarketingNavigation.stx'), 'utf8')
const auth = readFileSync(join(import.meta.dir, '../../resources/views/layouts/auth.stx'), 'utf8')

/*
 * These used to read the CSS out of the page's own <style> block. That CSS is
 * in config/crosswind.ts now (stx-standards rule 3), so they generate it
 * instead -- which is the stronger assertion anyway: a rule can be present in
 * the config and still not reach the page, and matching the source text never
 * proved it did.
 */
/*
 * Through stx's own loader and merge, which is what renders the page.
 *
 * This used to construct a generator from `@cwcss/crosswind` and hand-merge the
 * theme. That package supplies this project's config TYPES and nothing else:
 * stx loads @stacksjs/ts-css on every path, so the old version verified an
 * engine the app never runs, and the two disagree on exactly the spellings this
 * config had to choose between.
 */
/** Whitespace-insensitive containment: stx pins minify false, so spacing varies. */
function has(css: string, needle: string): boolean {
  return css.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))
}

async function generate(...classes: string[]): Promise<string> {
  const engine = await loadCssEngine()
  if (!engine)
    throw new Error('The installed STX CSS engine is required')
  const merged = mergeCssConfig(engine.defaultConfig || engine.config, theme)
  const generator = new engine.CSSGenerator(merged.config)
  for (const className of classes)
    generator.generate(className)
  return (merged.tokenCSS || '') + generator.toCSS(merged.includePreflight, merged.minify)
}

// iOS Safari zooms the page when a focused input's font-size is under 16px,
// and leaves it zoomed and scrolled sideways afterwards. The sign-in and
// sign-up forms are the first thing a phone user types into.
describe('mobile layout contracts', () => {
  it('keeps auth inputs at 16px so iOS does not zoom on focus', async () => {
    const css = await generate('field')
    const field = css.replace(/\s+/g, '').match(/\.field\{[^}]*\}/)?.[0] ?? ''
    const size = Number(field.match(/font-size:(\d+(?:\.\d+)?)px/)?.[1])
    expect(size).toBeGreaterThanOrEqual(16)
  })

  it('still gives the field its own family rather than inheriting one', async () => {
    /*
     * The shortcut spells the family out instead of carrying the original
     * `font: 400 16px/1.4 …` shorthand, because an arbitrary property named
     * after a utility family resolves to that family's longhand in this
     * engine: `[font:400_16px/1.4_…]` emits `font-weight: 400 16px/1.4 …`,
     * which is not a declaration. Asserting the family keeps the decomposition
     * honest, and `font-weight: 400` proves nothing was lost in it.
     */
    const css = await generate('field')
    expect(has(css, 'font-family: ui-sans-serif, -apple-system, sans-serif')).toBe(true)
    expect(has(css, 'font-weight: 400')).toBe(true)
    expect(css).not.toMatch(/font-weight:\s*400 16px/)
  })

  it('leaves pinch-zoom available on the auth pages', () => {
    const viewport = auth.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? ''
    expect(viewport).toContain('width=device-width')
    expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1(?![.\d])/)
  })

  // 100vh is the largest the viewport ever gets on iOS, so a panel capped by it
  // runs under the browser's bottom bar; 100dvh tracks the visible height.
  it('bounds the phone menu by the visible viewport and locks the page behind it', async () => {
    const panel = nav.match(/<details class="[^"]*mobile-menu[^"]*">[\s\S]*?<div class="([^"]*)"/)?.[1] ?? ''
    expect(panel).toContain('max-h-[calc(100dvh-6rem)]')
    expect(panel).not.toContain('100vh')
    expect(panel).toContain('overscroll-contain')

    // The scroll lock is a preflight rule now; it cannot be a utility because
    // it styles <body> from inside this component.
    expect(has(await generate('block'), 'body:has(.mobile-menu[open]){overflow:hidden}')).toBe(true)
  })

  it('hides the details marker, which an arbitrary-variant utility would not', async () => {
    /*
     * [&::-webkit-details-marker]:hidden is the obvious spelling and emits
     * nothing here: the extractor drops any class whose variant is an
     * arbitrary selector, so it never reaches the generator (same defect as
     * stacksjs/ts-css#37). Hence a preflight rule, and hence this assertion --
     * without it the twin arrows come back and nothing fails.
     */
    expect(has(await generate('block'), '.feature-summary::-webkit-details-marker{display:none}')).toBe(true)
  })

  it('no preflight entry quotes a font family with double quotes', () => {
    /*
     * The one real preflight hazard here, and it is quoting rather than
     * structure. A double-quoted family name makes ts-css replace the stack
     * with its own default AND swallow everything up to the next `transform`,
     * which ate all of h1-h3 and the opening half of @keyframes reveal and
     * spliced the leftovers into the body rule. Single quotes are clean and
     * mean the same thing in CSS.
     *
     * It fails silently and reads as a font that never applied, so the shape is
     * pinned rather than the symptom.
     */
    for (const preflight of (theme as any).preflights as { getCSS: () => string }[]) {
      const css = preflight.getCSS()
      expect([...css.matchAll(/font-family\s*:[^;}]*"/g)].map(m => m[0])).toEqual([])
    }
  })
})
