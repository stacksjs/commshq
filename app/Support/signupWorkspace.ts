import { createHash, randomUUID } from 'node:crypto'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { isUniqueViolation } from '@stacksjs/orm'
import { invitationStatus, normalizeInvitationEmail } from '../../storage/framework/defaults/app/Actions/Dashboard/Teams/team-records'
import { ensureOpenMetersNow } from './usagePeriods'

/**
 * The workspace a person gets for signing up.
 *
 * The sign-up page promises "Create your workspace", but the framework's
 * register only creates the user. Membership lives in `team_members`, so a
 * new account belonged to no workspace and every dashboard request answered
 * 403. `ensureSignupWorkspace` makes the workspace and the owner membership.
 * The `team` middleware calls it when it finds no membership, so an account
 * gets its workspace on its first dashboard request, including accounts made
 * before this existed.
 *
 * Two people are left alone:
 *
 * - Anyone with a membership row, active or suspended: a suspended member
 *   is not handed a workspace of their own to get round it. Removing a
 *   member deletes the row, so someone removed starts again like anyone
 *   new, with an empty workspace and no access to the old one.
 * - Anyone with a pending invitation for their address. They signed up to
 *   join that workspace, and with no workspace switcher an empty one of their
 *   own, made first, would be the one every page opens.
 */

/** Team names are unique, and stored up to 100 characters. */
const NAME_MAX = 100

/** "Ada's workspace" from "Ada Lovelace", or "My workspace" with no usable name. */
export function workspaceName(personName: unknown): string {
  const first = String(personName ?? '').trim().split(/\s+/)[0] ?? ''
  const clean = first.replace(/[^\p{L}\p{N}'.-]/gu, '').slice(0, 40)
  return clean.length >= 1 ? `${clean}'s workspace` : 'My workspace'
}

/** The names to try in turn when the first one is taken. */
export function workspaceNameCandidates(base: string, suffix: string = randomUUID().slice(0, 8)): string[] {
  const names = [base, `${base} 2`, `${base} 3`, `${base} ${suffix}`]
  return names.map(name => name.slice(0, NAME_MAX))
}

/** Any membership row, active or suspended. */
/**
 * The uuid of the workspace sign-up makes for a user, the same every time.
 *
 * The dashboard asks for several things at once, so two first requests can
 * both find no workspace. `teams.uuid` is unique, so only one insert lands;
 * the other finds that workspace by this uuid and uses it.
 */
export function signupWorkspaceUuid(userId: number): string {
  const hex = createHash('sha256').update(`commshq:signup-workspace:${userId}`).digest('hex')
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function teamByUuid(uuid: string): Promise<number | null> {
  const row = await db.selectFrom('teams' as any).select(['id'] as any)
    .where('uuid' as any, '=', uuid).executeTakeFirst() as { id: number } | undefined
  return row ? Number(row.id) : null
}

async function hasMembership(userId: number): Promise<boolean> {
  const row = await db.selectFrom('team_members' as any).select(['id'] as any)
    .where('user_id' as any, '=', userId)
    .executeTakeFirst()
  return Boolean(row)
}

async function hasPendingInvitation(email: unknown, now: Date): Promise<boolean> {
  const address = normalizeInvitationEmail(email)
  if (!address)
    return false
  const rows = await (db as any).selectFrom('team_invitations')
    .select(['status', 'expires_at'])
    .where('email', '=', address)
    .where('status', '=', 'pending')
    .execute() as Array<{ status: string, expires_at: unknown }>
  return rows.some(row => invitationStatus(row.status, row.expires_at, now) === 'pending')
}

export type SignupWorkspaceOutcome = 'created' | 'member' | 'invited'

/** Make the person's workspace unless they belong to one or are invited to one. */
export async function ensureSignupWorkspace(user: { id: unknown, name?: unknown, email?: unknown }, now: Date = new Date()): Promise<{ outcome: SignupWorkspaceOutcome, teamId: number | null }> {
  const userId = Number(user.id)
  if (!Number.isInteger(userId) || userId < 1)
    throw new Error('A workspace needs a saved user.')
  if (await hasMembership(userId))
    return { outcome: 'member', teamId: null }
  if (await hasPendingInvitation(user.email, now))
    return { outcome: 'invited', teamId: null }

  const stamp = now.toISOString()
  const uuid = signupWorkspaceUuid(userId)
  for (const name of workspaceNameCandidates(workspaceName(user.name))) {
    try {
      const teamId = await (db as any).transaction(async (trx: any) => {
        await trx.insertInto('teams').values({
          name,
          description: null,
          status: 'active',
          member_count: 1,
          uuid,
          created_at: stamp,
          updated_at: stamp,
        }).execute()
        const team = await trx.selectFrom('teams').select(['id']).where('uuid', '=', uuid).executeTakeFirst() as { id: number } | undefined
        if (!team)
          throw new Error('The new workspace could not be read back.')
        await trx.insertInto('team_members').values({
          team_id: team.id,
          user_id: userId,
          role: 'owner',
          status: 'active',
          uuid: randomUUID(),
          created_at: stamp,
          updated_at: stamp,
        }).execute()
        return Number(team.id)
      })

      // Meters are also opened on first use, so a failure here costs nothing.
      try {
        await ensureOpenMetersNow(teamId)
      }
      catch (error) {
        log.warn(`[signup] usage meters for workspace ${teamId} were not opened: ${error instanceof Error ? error.message : String(error)}`)
      }
      return { outcome: 'created', teamId }
    }
    catch (error) {
      if (!isUniqueViolation(error))
        throw error
      // A request alongside this one made it first: its insert and the
      // membership were one transaction, so both are there.
      const made = await teamByUuid(uuid)
      if (made)
        return { outcome: 'member', teamId: made }
      // Otherwise another workspace has this name: try the next one.
    }
  }
  throw new Error('No free workspace name was found.')
}
