import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import theme from '../../config/crosswind'
import { processComponents } from '../../node_modules/@stacksjs/stx/dist/component-renderer.js'
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const root = resolve(import.meta.dir, '../..')

describe('shared workspace badges', () => {
  for (const [component, samples] of [
    ['CommandCenter', [{ text: '+18.4%', item: { change: '+18.4%' } }]],
    ['WorkspaceSurface', [{ text: 'Complete', record: { status: 'Complete' } }, { text: 'On', check: { state: 'On' } }]],
  ] as const) {
    test(`${component} uses quiet shared badges and preserves its status text`, async () => {
      const file = resolve(root, `resources/components/CommsHQ/${component}.stx`)
      const badges = readFileSync(file, 'utf8').match(/<Badge\b[^]*?<\/Badge>/g) || []
      expect(badges).toHaveLength(samples.length)
      for (const [index, badge] of badges.entries()) {
        const html = await processComponents(badge, {
          ...samples[index],
          __importedComponents: new Map([['badge', resolve(root, 'node_modules/@stacksjs/components/src/ui/badge/Badge.stx')]]),
        }, file, { componentsDir: resolve(root, 'resources/components') }, new Set())
        expect(html).toContain(samples[index].text)
        expect(html).not.toContain('<Badge')
        expect(html).not.toContain('[Component Error')
        expect(html).not.toContain('aria-live=')
        expect(html).not.toContain('x-cloak')
      }
    })
  }

  /*
   * This used to render AudienceWorkspace's two consent pills through <Badge>
   * and assert the component resolved. It cannot any more, and the reason is
   * the point of the change rather than a regression: the contacts there are
   * no longer four literals in a server script, they arrive from
   * `/api/v1/contacts` and are rendered by a client `:for`. <Badge> is a
   * server component, so it cannot be the markup inside a loop whose items
   * only exist in the browser.
   *
   * What the test was protecting survives, and is what is asserted instead:
   * the pill carries the one shared `audience-consent-badge` treatment rather
   * than a bespoke pill rebuilt inline, it still sits in the <dd> of the
   * mobile card's consent row, and it is still QUIET - no role="status", no
   * aria-live, no button inside a cell. A status that announces itself on
   * every row would talk over a table of twenty-five people.
   *
   * The palette itself is locked by the sibling test below, which generates
   * the shortcut's CSS and is indifferent to which element wears it.
   */
  test('audience consent keeps the shared badge treatment and stays quiet', () => {
    const file = resolve(root, 'resources/components/CommsHQ/AudienceWorkspace.stx')
    const source = readFileSync(file, 'utf8')

    // One for the phone card, one for the table cell, as before.
    const pills = source.match(/<span class="audience-consent-badge">[^]*?<\/span>/g) || []
    expect(pills).toHaveLength(2)
    for (const pill of pills) {
      expect(pill).toContain('{{ contact.statusLabel }}')
      expect(pill).not.toContain('role="status"')
      expect(pill).not.toContain('aria-live=')
      expect(pill).not.toContain('<button')
    }

    // The consent row of the mobile card still carries it as the <dd>.
    expect(source).toMatch(/<dd><span class="audience-consent-badge">[^]*?<\/span><\/dd>/)

    // And nothing reintroduced a hand-rolled pill beside the shared one.
    expect(source).not.toMatch(/class="[^"]*\bbg-\[#edf5e8\]/)
  })

  test('audience badge utilities preserve the existing light and dark consent palette', async () => {
    const engine = await loadCssEngine()
    if (!engine) throw new Error('The installed STX CSS engine is required')
    const generator = new engine.CSSGenerator(mergeCssConfig(engine.defaultConfig || engine.config, theme).config)
    generator.generate('audience-consent-badge')
    const css = generator.toCSS(false, false)
    expect(css).toContain('.audience-consent-badge')
    expect(css).toContain('font-weight: 700 !important')
    expect(css).toContain('#466833 !important')
    expect(css).toContain('#edf5e8 !important')
    expect(css).toContain('#acd294 !important')
    expect(css).toContain('0.625rem !important')
    expect(css).toContain('0.25rem !important')
    expect(css).toContain('.dark')
    // Desktop table cells previously used inline pills, unlike mobile cards.
    expect(css).toContain('display: inline !important')
    expect(css).toContain('640px')
  })

  test('workspace badge utilities retain the compact typography and contextual colors', async () => {
    const engine = await loadCssEngine()
    if (!engine) throw new Error('The installed STX CSS engine is required')
    for (const [shortcut, declarations] of [
      ['workspace-change-badge', ['#42652e', '#a8d28e', '#eef5e8', '11px', '0.625rem']],
      ['workspace-record-badge', ['#466833', '#acd294', '#eef5e8', '10px']],
      ['workspace-check-badge', ['#bfe2ab', '10px']],
    ] as const) {
      const generator = new engine.CSSGenerator(mergeCssConfig(engine.defaultConfig || engine.config, theme).config)
      generator.generate(shortcut)
      const css = generator.toCSS(false, false)
      expect(css).toContain(`.${shortcut}`)
      for (const declaration of declarations) expect(css).toContain(`${declaration} !important`)
      expect(css).toContain('font-weight: 700 !important')
      expect(css).toContain('line-height: inherit !important')
      expect(css).toContain('display: flex !important')
      expect(css).toContain('0.25rem !important')
    }
  })
})
