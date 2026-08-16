import { describe, expect, it } from 'bun:test'
import { basename } from 'node:path'

async function files(pattern: string, cwd = import.meta.dir): Promise<string[]> {
  return Array.fromAsync(new Bun.Glob(pattern).scan({ cwd, absolute: true, onlyFiles: true }))
}

describe('tenant model contracts', () => {
  it('scopes every application model and generated API to Team', async () => {
    const modelFiles = await files('../../app/Models/*.ts')
    expect(modelFiles.length).toBeGreaterThanOrEqual(57)

    for (const file of modelFiles) {
      const source = await Bun.file(file).text()
      expect(source, `${basename(file)} must belong to Team`).toMatch(/belongsTo:\s*\[[^\]]*['"]Team['"]/s)
      expect(source, `${basename(file)} must protect API routes`).toContain("middleware: ['auth', 'team']")
    }
  })

  it('keeps schema changes model-generated', async () => {
    const migrations = await files('../../database/migrations/*.sql')
    const snapshot = Bun.file(new URL('../../storage/framework/database/model-snapshot.sqlite.json', import.meta.url))
    expect(migrations.length).toBeGreaterThan(250)
    expect(await snapshot.exists()).toBe(true)
  })
})

describe('interface contracts', () => {
  it('ships every primary product page through the shared state-rich surface', async () => {
    const required = ['onboarding', 'segments', 'editor', 'sites', 'forms', 'publications', 'commerce', 'monetization', 'analytics', 'integrations', 'billing', 'domains', 'senders', 'teams', 'settings']
    for (const page of required) {
      const source = await Bun.file(new URL(`../../resources/views/dashboard/commshq/${page}.stx`, import.meta.url)).text()
      expect(source).toContain(`<WorkspaceSurface area="${page}" />`)
    }

    const surface = await Bun.file(new URL('../../resources/components/CommsHQ/WorkspaceSurface.stx', import.meta.url)).text()
    for (const state of ['populated', 'loading', 'empty', 'error']) expect(surface).toContain(`'${state}'`)
  })

  it('rejects browser scripting, hand-drawn icons, and forbidden punctuation in product STX', async () => {
    const resourceFiles = await files('../../resources/**/*.stx')
    for (const file of resourceFiles) {
      const source = await Bun.file(file).text()
      expect(source, `${basename(file)} contains forbidden punctuation`).not.toMatch(/[—–]/)
      expect(source, `${basename(file)} contains direct browser scripting`).not.toMatch(/\b(?:window|document)\s*\./)
      expect(source, `${basename(file)} contains a hand-drawn SVG`).not.toMatch(/<svg\b/i)
    }
  })
})
