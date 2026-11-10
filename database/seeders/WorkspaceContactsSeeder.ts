import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'

/**
 * Give the seeded contacts an owner, and a history.
 *
 * The audience page reads `/api/v1/contacts`, which the `useApi` trait
 * generates and the auto-CRUD layer scopes to the caller's team through
 * `belongsTo: ['Team']`. The model pass cannot fill that column: `Team` is on
 * the seeder's ACCOUNT_MODELS list, so every foreign key to it is left null on
 * purpose, and 36 seeded contacts owned by nobody are 36 contacts the page
 * correctly refuses to show. Signing in got you a working, empty table.
 *
 * So this is the other half of `./buddy seed`, and the half the framework says
 * belongs to the application: it claims the orphans for the workspace
 * OwnerSeeder just created.
 *
 * It also writes the timeline, which the attribute factories cannot. A factory
 * sees one column of one row, and `status`, `created_at` and `last_engaged_at`
 * only make sense together: an archived contact who last engaged yesterday, or
 * engaged a year before the row existed, is noise that reads as a bug in the
 * page rather than as invented data. One pass that holds the whole row can
 * keep them consistent, so the timeline is built here from the row's position
 * and nowhere else.
 */

/**
 * The status spread, as one cycle of twelve.
 *
 * Read by row position rather than drawn at random, so every option in the
 * page's status filter has rows behind it in every seed run. A filter whose
 * options sometimes match nothing cannot be told apart from a filter that is
 * broken. Over the 36 seeded rows this gives 18 active, 6 pending,
 * 6 unsubscribed, 3 suppressed and 3 archived: weighted towards active,
 * because an audience where a third of the people are unreachable would
 * misrepresent what the page is for.
 */
const STATUS_CYCLE = [
  'active',
  'active',
  'active',
  'active',
  'active',
  'active',
  'pending',
  'pending',
  'unsubscribed',
  'unsubscribed',
  'suppressed',
  'archived',
] as const

/**
 * Walk the cycle in steps of five rather than one.
 *
 * Five and twelve share no factor, so every slot is still visited the same
 * number of times and the spread above is unchanged. What changes is that the
 * spread no longer lines up with the timeline: read in order, the cycle puts
 * its churned statuses at the end, and because the batch is also ordered
 * oldest-first, every newly seeded contact came out archived or suppressed.
 * The page sorts newest first, so the top of the audience was nothing but
 * people who had already left.
 */
const STATUS_STRIDE = 5

/**
 * How far through a contact's own life they last engaged, by status.
 *
 * Expressed as a fraction of the time between their row being created and now,
 * rather than as an age, which is what keeps the two dates in order however
 * old the row is. `pending` is absent: they have never engaged, which is what
 * `pending` means, and the column stays null so the table shows the page's own
 * placeholder instead of inventing a date for it.
 */
const ENGAGEMENT_POINT: Record<string, number> = {
  active: 0.92,
  unsubscribed: 0.45,
  suppressed: 0.35,
  archived: 0.12,
}

/** The window the seeded audience was built over: two years, ending a couple of days ago. */
const OLDEST_DAYS = 720
const NEWEST_DAYS = 2
const DAY_MS = 86_400_000

interface ContactRow {
  id: number
  email: string | null
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - Math.max(0, days) * DAY_MS).toISOString()
}

/**
 * The timeline for one claimed row.
 *
 * `index` is the row's position in the claimed batch and `total` the size of
 * it, so the batch is spread evenly across the window above with the oldest
 * first. Evenly, and therefore with distinct timestamps: the page sorts by
 * `-created_at`, and 36 rows sharing one `CURRENT_TIMESTAMP` have no order for
 * SQLite to honour, which let a row seen on page one appear again on page two.
 *
 * The small jitter is there only so two years of sign-ups do not land on an
 * exact 20-day grid. It is derived from the index rather than drawn, so a
 * reseed produces the same audience and a surprising row stays reproducible.
 */
export function contactTimeline(index: number, total: number): { status: string, createdAt: string, lastEngagedAt: string | null } {
  const span = OLDEST_DAYS - NEWEST_DAYS
  const step = total > 1 ? span / (total - 1) : 0
  const jitter = ((index % 7) - 3) * 0.4
  const createdDaysAgo = Math.min(OLDEST_DAYS, Math.max(NEWEST_DAYS, OLDEST_DAYS - index * step + jitter))
  const status = STATUS_CYCLE[(index * STATUS_STRIDE) % STATUS_CYCLE.length] as string
  const point = ENGAGEMENT_POINT[status]

  return {
    status,
    createdAt: isoDaysAgo(createdDaysAgo),
    lastEngagedAt: point === undefined ? null : isoDaysAgo(createdDaysAgo * (1 - point)),
  }
}

export default class WorkspaceContactsSeeder extends Seeder {
  /** After OwnerSeeder, which is order 0 and is what creates the workspace. */
  static order = 10
  static tags = ['demo']

  async run(): Promise<void> {
    /*
     * Production is the one environment where this is unsafe. Everywhere else
     * an invented audience is the point; there it would put 36 fabricated
     * people into a real workspace, where they are one campaign away from
     * being sent to. The addresses are on example.com and cannot receive it,
     * but a bounce rate built out of seed data is still a reputation.
     */
    if (isProductionEnv()) {
      log.info(`[WorkspaceContactsSeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get an invented audience.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspaceContactsSeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet, so there is no owner to claim contacts for.`)
      return
    }

    const orphans = await db.selectFrom('contacts' as any)
      .select(['id', 'email'] as any)
      .where('team_id' as any, 'is', null)
      .orderBy('id' as any)
      .execute() as ContactRow[]

    if (orphans.length === 0) {
      log.info('[WorkspaceContactsSeeder] Nothing to claim: every contact already belongs to a workspace.')
      return
    }

    /*
     * `contacts_team_email_unique` spans (team_id, email), so a claim is an
     * insert's worth of risk: the update fails if the workspace already holds
     * that address. The factories number their addresses and cannot collide
     * with each other, but a workspace that has been used has real contacts in
     * it, and a seeded row must not be what breaks `./buddy seed` for them.
     * A colliding orphan is left unclaimed and counted rather than dropped.
     */
    const taken = new Set((await db.selectFrom('contacts' as any)
      .select(['email'] as any)
      .where('team_id' as any, '=', teamId)
      .execute() as { email: string | null }[])
      .map(row => (row.email || '').toLowerCase())
      .filter(Boolean))

    const claimable = orphans.filter((contact) => {
      const email = (contact.email || '').toLowerCase()
      if (email && taken.has(email))
        return false
      if (email)
        taken.add(email)
      return true
    })

    /*
     * One statement per row, which the ORM's N+1 heuristic reports as
     * "Possible N+1" in development. It is a false positive: that heuristic
     * watches a request handler fetching one row at a time inside a loop it
     * could have hoisted, and this is a seeder writing a distinct timeline to
     * each row it claims. There is no read being repeated and nothing to
     * hoist. Collapsing it into a single UPDATE ... CASE would silence the
     * warning, at the cost of hand-built SQL plus chunking to stay under the
     * placeholder limit once `useSeeder.count` grows, which is more machinery
     * than a one-line warning on a local seed run is worth.
     */
    for (const [index, contact] of claimable.entries()) {
      const timeline = contactTimeline(index, claimable.length)
      await db.updateTable('contacts' as any)
        .set({
          team_id: teamId,
          status: timeline.status,
          created_at: timeline.createdAt,
          last_engaged_at: timeline.lastEngagedAt,
          updated_at: new Date().toISOString(),
        } as any)
        .where('id' as any, '=', contact.id)
        .execute()
    }

    const skipped = orphans.length - claimable.length
    log.info(`[WorkspaceContactsSeeder] Claimed ${claimable.length} contact(s) for ${OWNER_WORKSPACE}${skipped > 0 ? `, leaving ${skipped} whose address the workspace already holds` : ''}.`)
  }
}

if (import.meta.main)
  await new WorkspaceContactsSeeder().run()
