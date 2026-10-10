import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const home = readFileSync(new URL('../../resources/views/index.stx', import.meta.url), 'utf8')

test('the hero image stays inside its grid column at desktop widths', () => {
  const figure = home.match(/<figure class="([^"]*)">/)?.[1] ?? ''
  expect(figure).toContain('min-w-0')
  expect(figure).not.toMatch(/(?:^|\s)(?:\w+:)?-mr-/)
})
