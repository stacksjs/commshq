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

  test('audience consent renders through Badge without becoming a live announcement', async () => {
    const file = resolve(root, 'resources/components/CommsHQ/AudienceWorkspace.stx')
    const source = readFileSync(file, 'utf8')
    const badges = source.match(/<Badge\b[^]*?<\/Badge>/g) || []
    expect(badges).toHaveLength(2)
    for (const badge of badges) {
      const dependencies = new Set<string>()
      const html = await processComponents(badge, {
        contact: { state: 'SMS consented' },
        __importedComponents: new Map([['badge', resolve(root, 'node_modules/@stacksjs/components/src/ui/badge/Badge.stx')]]),
      }, file, { componentsDir: resolve(root, 'resources/components') }, dependencies)
      expect([...dependencies]).toContain(resolve(root, 'node_modules/@stacksjs/components/src/ui/badge/Badge.stx'))
      expect(html).toContain('SMS consented')
      expect(html).toContain('audience-consent-badge')
      expect(html).not.toContain('<Badge')
      expect(html).not.toContain('[Component Error')
      expect(html).not.toContain('role="status"')
      expect(html).not.toContain('aria-live=')
      expect(html).not.toContain('<button')
    }
    expect(source).toMatch(/<dd>\s*<Badge[^]*?<\/Badge>\s*<\/dd>/)
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
