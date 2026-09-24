import Audience from '../../Models/Audience'
import AudienceMembership from '../../Models/AudienceMembership'

type MembershipStatus = 'active' | 'pending' | 'unsubscribed'

/**
 * A form belongs to an audience, and a signup is how somebody joins it.
 *
 * Before this, a signup created the contact and nothing else, so "the
 * newsletter's subscribers" was every active contact in the workspace and a
 * campaign had no way to go to one list. A double opt-in signup joins as
 * `pending` and becomes `active` on confirmation; a single opt-in joins
 * `active` straight away.
 */
export async function joinAudience(teamId: number, audienceId: number | null | undefined, contactId: number, status: MembershipStatus): Promise<void> {
  if (!audienceId)
    return
  const audience = await Audience.where('id', audienceId).where('team_id', teamId).first()
  if (!audience)
    return

  const existing = await AudienceMembership.where('audience_id', audienceId).where('contact_id', contactId).first()
  const now = new Date().toISOString()
  if (!existing) {
    await AudienceMembership.forceCreate({ team_id: teamId, audience_id: audienceId, contact_id: contactId, status, joinedAt: now })
  }
  // A pending signup never demotes an active member: signing up twice is not
  // a reason to stop sending to someone who already confirmed.
  else if (existing.status !== status && !(existing.status === 'active' && status === 'pending')) {
    await AudienceMembership.forceUpdate(existing.id, { status, joinedAt: status === 'active' ? now : existing.joinedAt, leftAt: null })
  }
  await refreshMemberCount(teamId, audienceId)
}

/** Everyone who leaves the channel leaves every list on it. */
export async function leaveAudiences(teamId: number, contactId: number): Promise<void> {
  const memberships = await AudienceMembership.where('team_id', teamId).where('contact_id', contactId).get()
  const now = new Date().toISOString()
  const touched = new Set<number>()
  for (const membership of memberships) {
    if (membership.status === 'unsubscribed')
      continue
    await AudienceMembership.forceUpdate(membership.id, { status: 'unsubscribed', leftAt: now })
    touched.add(Number(membership.audience_id))
  }
  for (const audienceId of touched)
    await refreshMemberCount(teamId, audienceId)
}

async function refreshMemberCount(teamId: number, audienceId: number): Promise<void> {
  const count = await AudienceMembership.where('audience_id', audienceId).where('team_id', teamId).where('status', 'active').count()
  await Audience.forceUpdate(audienceId, { memberCount: Number(count) || 0 })
}
