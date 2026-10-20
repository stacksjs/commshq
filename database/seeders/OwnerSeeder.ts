import { assignRole, seedDefaultRoles } from '@stacksjs/auth'
import { db, Seeder } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { log } from '@stacksjs/logging'
import { makeHash } from '@stacksjs/security'

const OWNER_WORKSPACE = 'CommsHQ'

/**
 * The local fallback, matching the other five HQ apps. `.localhost` is
 * reserved by RFC 6761 and resolves nowhere but this machine, so the address
 * cannot be mistaken for a real mailbox or receive a stray notification --
 * which is why the fallback is not the production default below.
 */
const DEV_EMAIL = 'owner@commshq.localhost'
/** What config/env.ts defaults COMMSHQ_OWNER_EMAIL to, and what a deploy gets. */
const PRODUCTION_DEFAULT_EMAIL = 'chris@stacksjs.com'
const DEV_PASSWORD = 'stacks-dev-only'

/**
 * APP_ENV values that may use the fallback above. config/env.ts types APP_ENV
 * as local|development|dev|staging|stage|production|prod|test|testing, so all
 * four local spellings are listed; `staging`/`stage` deliberately are not, and
 * fall through to the branch that requires the password to be supplied.
 */
const LOCAL_ENVS = new Set(['local', 'development', 'dev', 'test', 'testing'])
const PRODUCTION_ENVS = new Set(['production', 'prod'])

interface IdentifiedRow {
  id: number
}

const BUSINESS_METERS = {
  contacts: 25_000,
  emails: 250_000,
  sms_segments: null,
  ai_generations: 5_000,
  custom_domains: 10,
} as const

async function findId(table: 'users' | 'teams', column: 'email' | 'name', value: string): Promise<number | undefined> {
  const row = await db.selectFrom(table as any)
    .select(['id'] as any)
    .where(column as any, '=', value)
    .executeTakeFirst() as IdentifiedRow | undefined

  // Number(): on Postgres a bigint id arrives as a string, and assignRole
  // refuses anything but a number ("RBAC user id must be a positive number"),
  // which stopped the production bootstrap before the usage meters.
  return row?.id === undefined ? undefined : Number(row.id)
}

async function ensureOwnerUsageMeters(teamId: number): Promise<void> {
  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()

  for (const [key, includedQuantity] of Object.entries(BUSINESS_METERS)) {
    const existing = await db.selectFrom('usage_meters' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .where('key' as any, '=', key)
      .where('period_start' as any, '=', periodStart)
      .executeTakeFirst() as IdentifiedRow | undefined
    if (existing) continue

    const createdAt = new Date().toISOString()
    await db.insertInto('usage_meters' as any).values({
      team_id: teamId,
      key,
      quantity: 0,
      included_quantity: includedQuantity,
      period_start: periodStart,
      period_end: periodEnd,
      uuid: crypto.randomUUID(),
      created_at: createdAt,
      updated_at: createdAt,
    } as any).execute()
  }
}

export default class OwnerSeeder extends Seeder {
  async run(): Promise<void> {
    const appEnv = String(env.APP_ENV || '').toLowerCase()
    const isLocal = LOCAL_ENVS.has(appEnv)
    const isProduction = PRODUCTION_ENVS.has(appEnv)

    const envEmail = String(env.COMMSHQ_OWNER_EMAIL || '').trim().toLowerCase()
    const envPassword = String(env.COMMSHQ_OWNER_PASSWORD || '')

    /*
     * A local environment falls back to the pair above, so a fresh clone can
     * sign in after one `./buddy seed` with nothing to configure -- the
     * behaviour the other five HQ apps already have, and the reason this one
     * was the odd app out with no local credential at all.
     *
     * The fallback is deliberately all-or-nothing, and that is the whole
     * subtlety. `env.COMMSHQ_OWNER_EMAIL` cannot report "unset": config/env.ts
     * gives it the default 'chris@stacksjs.com', so a seeder that fell back on
     * the password alone would pair a real address with a password committed
     * to this repository, and create exactly that account on any machine that
     * ran the seeder. It did, once, before this was written this way.
     *
     * So the password decides. Supply one and the email behaves as it always
     * did -- yours, or the configured default. Supply none and, locally, both
     * come from the pair above. Outside a local APP_ENV nothing changed:
     * the password is still required, production still refuses without it, and
     * the configured default is still what a deploy gets.
     */
    const email = envPassword
      ? (envEmail || PRODUCTION_DEFAULT_EMAIL)
      : (isLocal ? DEV_EMAIL : (envEmail || PRODUCTION_DEFAULT_EMAIL))
    const password = envPassword || (isLocal ? DEV_PASSWORD : '')
    const usedFallback = !envPassword && isLocal

    if (!password) {
      if (isProduction)
        throw new Error('COMMSHQ_OWNER_PASSWORD is required for the production owner bootstrap.')

      log.info(`[OwnerSeeder] Skipped: COMMSHQ_OWNER_PASSWORD is not set and APP_ENV="${appEnv}" is not a local environment.`)
      return
    }

    await seedDefaultRoles()

    let userId = await findId('users', 'email', email)
    if (!userId) {
      const now = new Date().toISOString()
      await db.insertInto('users' as any).values({
        name: 'Chris Breuer',
        email,
        password: await makeHash(password, { algorithm: 'bcrypt' }),
        uuid: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      } as any).execute()
      userId = await findId('users', 'email', email)
    }

    if (!userId)
      throw new Error('The CommsHQ owner account could not be resolved after creation.')

    let teamId = await findId('teams', 'name', OWNER_WORKSPACE)
    if (!teamId) {
      const now = new Date().toISOString()
      await db.insertInto('teams' as any).values({
        name: OWNER_WORKSPACE,
        description: 'Owner workspace for CommsHQ.',
        status: 'active',
        member_count: 1,
        uuid: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      } as any).execute()
      teamId = await findId('teams', 'name', OWNER_WORKSPACE)
    }

    if (!teamId)
      throw new Error('The CommsHQ owner workspace could not be resolved after creation.')

    const membership = await db.selectFrom('team_members' as any)
      .select(['id'] as any)
      .where('team_id' as any, '=', teamId)
      .where('user_id' as any, '=', userId)
      .executeTakeFirst() as IdentifiedRow | undefined

    if (!membership) {
      const now = new Date().toISOString()
      await db.insertInto('team_members' as any).values({
        team_id: teamId,
        user_id: userId,
        role: 'owner',
        status: 'active',
        uuid: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    await assignRole(userId, 'admin')
    await ensureOwnerUsageMeters(teamId)
    log.info(`[OwnerSeeder] Owner workspace is ready for ${email}.`)
    if (usedFallback)
      log.info(`[OwnerSeeder] Local fallback credentials in use: ${email} / ${DEV_PASSWORD}`)
  }
}

if (import.meta.main)
  await new OwnerSeeder().run()
