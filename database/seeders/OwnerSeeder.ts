import { assignRole, seedDefaultRoles } from '@stacksjs/auth'
import { db, Seeder } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { log } from '@stacksjs/logging'
import { makeHash } from '@stacksjs/security'

const OWNER_WORKSPACE = 'CommsHQ'

interface IdentifiedRow {
  id: number
}

async function findId(table: 'users' | 'teams', column: 'email' | 'name', value: string): Promise<number | undefined> {
  const row = await db.selectFrom(table as any)
    .select(['id'] as any)
    .where(column as any, '=', value)
    .executeTakeFirst() as IdentifiedRow | undefined

  return row?.id
}

export default class OwnerSeeder extends Seeder {
  async run(): Promise<void> {
    const email = String(env.COMMSHQ_OWNER_EMAIL || 'chris@stacksjs.com').trim().toLowerCase()
    const password = String(env.COMMSHQ_OWNER_PASSWORD || '')
    const isProduction = ['prod', 'production'].includes(String(env.APP_ENV || '').toLowerCase())

    if (!password) {
      if (isProduction)
        throw new Error('COMMSHQ_OWNER_PASSWORD is required for the production owner bootstrap.')

      log.info('[OwnerSeeder] Skipped owner bootstrap because COMMSHQ_OWNER_PASSWORD is not set.')
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
    log.info(`[OwnerSeeder] Owner workspace is ready for ${email}.`)
  }
}

if (import.meta.main)
  await new OwnerSeeder().run()
