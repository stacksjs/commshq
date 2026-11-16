import process from 'node:process'
import { config } from '@stacksjs/config'
import { db } from '@stacksjs/database'

/**
 * One statement, run on this app's database, answering its rows.
 *
 * The statements that use it are written once, with `?` for each value, and
 * run on Postgres in production and on SQLite in the tests that hand the same
 * code a database of their own. Postgres numbers its placeholders, so they are
 * rewritten here and nowhere else.
 */
export type SqlRun = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

export const IS_POSTGRES: boolean = (process.env.DB_CONNECTION ?? String((config as any).database?.default ?? 'sqlite')) === 'postgres'

export const sqlRun: SqlRun = (sql, params = []) => {
  let i = 0
  return db.unsafe(IS_POSTGRES ? sql.replace(/\?/g, () => `$${++i}`) : sql, params) as unknown as Promise<Record<string, unknown>[]>
}
