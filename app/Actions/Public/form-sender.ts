import SenderIdentity from '../../Models/SenderIdentity'

export interface ResolvedSender {
  from: { name: string, address: string }
  replyTo?: string
}

/**
 * The From of a form's email: its SenderIdentity, if that identity is an
 * email identity in the same team and has been verified. Anything else falls
 * back to the workspace default rather than sending as an address the team
 * has not proven it owns.
 */
export async function formSender(teamId: number, senderIdentityId: number | undefined): Promise<ResolvedSender | undefined> {
  if (!senderIdentityId)
    return undefined
  const identity = await SenderIdentity.where('id', senderIdentityId).where('team_id', teamId).first()
  if (!identity || identity.channel !== 'email' || identity.status !== 'verified' || !identity.address)
    return undefined
  return {
    from: { name: String(identity.name || identity.address), address: String(identity.address) },
    replyTo: identity.replyTo ? String(identity.replyTo) : undefined,
  }
}
