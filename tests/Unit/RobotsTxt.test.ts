import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const robots = readFileSync(join(import.meta.dir, '../../public/robots.txt'), 'utf8')

// scripts/smoke-deployment.ts fetches /robots.txt on production after every
// deploy and fails the run if it is missing, names the wrong host, or leaks a
// localhost URL. Checking the same things here keeps that gate from going red
// only after the code is already live.
describe('robots.txt', () => {
  it('names the production host and no local one', () => {
    expect(robots).toContain('commshq.org')
    expect(robots).not.toContain('localhost')
  })

  it('keeps crawlers out of the auth-walled and API routes', () => {
    for (const path of ['/dashboard', '/login', '/register', '/api/'])
      expect(robots).toContain(`Disallow: ${path}`)
    expect(robots).toContain('Allow: /')
  })
})
