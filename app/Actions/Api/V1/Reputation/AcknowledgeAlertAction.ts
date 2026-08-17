import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import AuditEvent from '../../../../Models/AuditEvent'
import ReputationAlert from '../../../../Models/ReputationAlert'
import { canTriageReputation } from '../../../Reputation/policy'
import { activeTeamId } from '../team'

const DECISIONS = ['acknowledged', 'resolved']

export default new Action({
  name: 'Acknowledge Reputation Alert',
  description: 'Records that a workspace member has picked up or closed out a reputation alert',
  method: 'POST',

  async handle(request: RequestInstance) {
    const teamId = await activeTeamId(request)
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canTriageReputation((user as any).team_role)) return response.json({ error: 'Alert triage requires a workspace member role' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'Alert id must be a positive integer' }, 422)

    const decision = String(request.get('decision') || '').toLowerCase()
    if (!DECISIONS.includes(decision)) return response.json({ error: 'decision must be acknowledged or resolved' }, 422)

    const alert = await ReputationAlert.where('id', id).where('team_id', teamId).first()
    if (!alert) return response.json({ error: 'Alert not found' }, 404)
    if (alert.status === 'resolved') return response.json({ error: 'Alert is already resolved' }, 409)
    if (alert.status === decision) return response.json({ error: `Alert is already ${decision}` }, 409)

    const decidedAt = new Date().toISOString()
    await ReputationAlert.forceUpdate(alert.id, {
      status: decision,
      // An alert resolved without a prior acknowledgement still records who acted.
      acknowledgedBy: Number(user.id),
      acknowledgedAt: alert.acknowledgedAt ? alert.acknowledgedAt : decidedAt,
      resolvedAt: decision === 'resolved' ? decidedAt : null,
    })

    await AuditEvent.forceCreate({
      team_id: teamId,
      user_id: Number(user.id),
      action: `reputation_alert.${decision}`,
      subjectType: 'ReputationAlert',
      subjectId: String(alert.id),
      metadata: JSON.stringify({ metric: String(alert.metric), severity: String(alert.severity) }),
      occurredAt: decidedAt,
    })

    return response.json({ data: await ReputationAlert.where('id', alert.id).where('team_id', teamId).first() })
  },
})
