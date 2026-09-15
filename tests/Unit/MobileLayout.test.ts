import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const auth = readFileSync(join(import.meta.dir, '../../resources/views/layouts/auth.stx'), 'utf8')

// iOS Safari zooms the page when a focused input's font-size is under 16px,
// and leaves it zoomed and scrolled sideways afterwards. The sign-in and
// sign-up forms are the first thing a phone user types into.
describe('mobile layout contracts', () => {
  it('keeps auth inputs at 16px so iOS does not zoom on focus', () => {
    const field = auth.match(/\.field\s*\{[^}]*\}/)?.[0] ?? ''
    const size = Number(field.match(/font:\s*\d+\s+(\d+(?:\.\d+)?)px/)?.[1])
    expect(size).toBeGreaterThanOrEqual(16)
  })

  it('leaves pinch-zoom available on the auth pages', () => {
    const viewport = auth.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? ''
    expect(viewport).toContain('width=device-width')
    expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1(?![.\d])/)
  })
})
