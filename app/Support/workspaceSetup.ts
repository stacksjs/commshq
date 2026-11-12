import { db } from '@stacksjs/database'

/**
 * What a workspace has set up, read from its own tables.
 *
 * The setup page used to state "63%, 5 of 8 steps" with a verified domain
 * and 1,248 imported contacts, for every account, whether it had done any of
 * it or not. Each step here is a question with a yes or no answer that the
 * database already holds, so the page can only say a step is done when it
 * is.
 *
 * The order is the order the work depends on: an email campaign cannot be
 * delivered until a domain is verified, a sender needs that domain, and a
 * campaign needs someone to send to.
 */
export const SETUP_STEPS = ['contacts', 'audience', 'domain', 'sender', 'campaign', 'sent', 'form', 'teammate'] as const

export type SetupStep = typeof SETUP_STEPS[number]

type Filter = [column: string, operator: string, value: unknown]

/** Whether at least `atLeast` rows of `table` belong to the team and match. */
async function has(table: string, teamId: number, filters: Filter[] = [], atLeast = 1): Promise<boolean> {
  let query = db.selectFrom(table as any).select(['id'] as any).where('team_id' as any, '=', teamId)
  for (const [column, operator, value] of filters)
    query = query.where(column as any, operator as any, value as any)
  const rows = await query.limit(atLeast).execute()
  return rows.length >= atLeast
}

export async function workspaceSetup(teamId: number): Promise<Record<SetupStep, boolean>> {
  const [contacts, audience, domain, sender, campaign, sent, form, teammate] = await Promise.all([
    has('contacts', teamId),
    has('audiences', teamId),
    // Verified, not merely added: a pending domain delivers nothing.
    has('sender_domains', teamId, [['status', '=', 'verified']]),
    has('sender_identities', teamId, [['channel', '=', 'email'], ['status', '=', 'verified']]),
    has('campaigns', teamId),
    has('campaigns', teamId, [['status', 'in', ['sending', 'sent']]]),
    // Active, since only an active form accepts a signup.
    has('form_definitions', teamId, [['status', '=', 'active']]),
    // A second active member; the first is whoever is asking.
    has('team_members', teamId, [['status', '=', 'active']], 2),
  ])
  return { contacts, audience, domain, sender, campaign, sent, form, teammate }
}
