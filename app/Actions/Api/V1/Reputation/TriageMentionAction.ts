import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../../Models/AuditEvent'
import ReputationMention from '../../../../Models/ReputationMention'
import { canTriageReputation } from '../../../Reputation/policy'
import { activeTeam } from '../team'

const STATUSES = ['triaged', 'responded', 'ignored']

export default new Action({
  name: 'Triage Reputation Mention',
  description: 'Marks a captured review or comment as triaged, responded to, or ignored',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canTriageReputation(membership?.role)) return response.json({ error: 'Mention triage requires a workspace member role' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'Mention id must be a positive integer' }, 422)

    const status = String(request.get('status') || '').toLowerCase()
    if (!STATUSES.includes(status)) return response.json({ error: 'status must be triaged, responded, or ignored' }, 422)

    const mention = await ReputationMention.where('id', id).where('team_id', teamId).first()
    if (!mention) return response.json({ error: 'Mention not found' }, 404)
    if (mention.status === status) return response.json({ error: `Mention is already ${status}` }, 409)

    const decidedAt = new Date().toISOString()
    await ReputationMention.forceUpdate(mention.id, {
      status,
      // Only a reply is a response; triaging and ignoring leave the reply fields alone.
      respondedAt: status === 'responded' ? decidedAt : mention.respondedAt,
      respondedBy: status === 'responded' ? Number(user.id) : mention.respondedBy,
    })

    await AuditEvent.forceCreate({
      team_id: teamId,
      user_id: Number(user.id),
      action: `reputation_mention.${status}`,
      subjectType: 'ReputationMention',
      subjectId: String(mention.id),
      metadata: JSON.stringify({ platform: String(mention.platform), sentiment: String(mention.sentiment) }),
      occurredAt: decidedAt,
    })

    return response.json({ data: await ReputationMention.where('id', mention.id).where('team_id', teamId).first() })
  },
})
