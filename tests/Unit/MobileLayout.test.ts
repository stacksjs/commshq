import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CSSGenerator, defaultConfig } from '@cwcss/crosswind'
import theme from '../../config/crosswind'

const nav = readFileSync(join(import.meta.dir, '../../resources/components/CommsHQ/MarketingNavigation.stx'), 'utf8')
const auth = readFileSync(join(import.meta.dir, '../../resources/views/layouts/auth.stx'), 'utf8')

/*
 * These used to read the CSS out of the page's own <style> block. That CSS is
 * in config/crosswind.ts now (stx-standards rule 3), so they generate it
 * instead -- which is the stronger assertion anyway: a rule can be present in
 * the config and still not reach the page, and matching the source text never
 * proved it did.
 */
function generate(...classes: string[]): string {
  const base: any = defaultConfig
  const merged: any = {
    ...base,
    ...theme,
    theme: { ...base.theme, extend: { ...(base.theme?.extend ?? {}), ...((theme as any).theme?.extend ?? {}) } },
  }
  const generator = new CSSGenerator(merged)
  for (const className of classes)
    generator.generate(className)
  return generator.toCSS(true, true)
}

// iOS Safari zooms the page when a focused input's font-size is under 16px,
// and leaves it zoomed and scrolled sideways afterwards. The sign-in and
// sign-up forms are the first thing a phone user types into.
describe('mobile layout contracts', () => {
  it('keeps auth inputs at 16px so iOS does not zoom on focus', () => {
    const css = generate('field')
    const field = css.match(/\.field\{[^}]*\}/)?.[0] ?? ''
    const size = Number(field.match(/font-size:(\d+(?:\.\d+)?)px/)?.[1])
    expect(size).toBeGreaterThanOrEqual(16)
  })

  it('still gives the field its own family rather than inheriting one', () => {
    /*
     * The shortcut spells the family out instead of carrying the original
     * `font: 400 16px/1.4 …` shorthand, because an arbitrary property named
     * after a utility family resolves to that family's longhand in this
     * engine: `[font:400_16px/1.4_…]` emits `font-weight: 400 16px/1.4 …`,
     * which is not a declaration. Asserting the family keeps the decomposition
     * honest, and `font-weight: 400` proves nothing was lost in it.
     */
    const css = generate('field')
    expect(css).toContain('font-family:ui-sans-serif,-apple-system,sans-serif')
    expect(css).toContain('font-weight:400')
    expect(css).not.toMatch(/font-weight:\s*400 16px/)
  })

  it('leaves pinch-zoom available on the auth pages', () => {
    const viewport = auth.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? ''
    expect(viewport).toContain('width=device-width')
    expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1(?![.\d])/)
  })

  // 100vh is the largest the viewport ever gets on iOS, so a panel capped by it
  // runs under the browser's bottom bar; 100dvh tracks the visible height.
  it('bounds the phone menu by the visible viewport and locks the page behind it', () => {
    const panel = nav.match(/<details class="[^"]*mobile-menu[^"]*">[\s\S]*?<div class="([^"]*)"/)?.[1] ?? ''
    expect(panel).toContain('max-h-[calc(100dvh-6rem)]')
    expect(panel).not.toContain('100vh')
    expect(panel).toContain('overscroll-contain')

    // The scroll lock is a preflight rule now; it cannot be a utility because
    // it styles <body> from inside this component.
    expect(generate('block')).toContain('body:has(.mobile-menu[open]){overflow:hidden}')
  })

  it('hides the details marker, which an arbitrary-variant utility would not', () => {
    /*
     * [&::-webkit-details-marker]:hidden is the obvious spelling and emits
     * nothing here: the extractor drops any class whose variant is an
     * arbitrary selector, so it never reaches the generator (same defect as
     * stacksjs/ts-css#37). Hence a preflight rule, and hence this assertion --
     * without it the twin arrows come back and nothing fails.
     */
    expect(generate('block')).toContain('.feature-summary::-webkit-details-marker{display:none}')
  })
})
