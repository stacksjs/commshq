import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import AiGeneration from '../../../Models/AiGeneration'
import AuditEvent from '../../../Models/AuditEvent'
import { canGenerateAi } from '../../Ai/generation-policy'
import { activeTeamId } from './team'

export default new Action({
  name: 'Decide AI Draft',
  description: 'Records an explicit human approval or rejection for a Bedrock-assisted draft',
  method: 'POST',

  async handle(request: RequestInstance) {
    const teamId = await activeTeamId(request)
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canGenerateAi((user as any).team_role)) return response.json({ error: 'AI review requires an editor, admin, or owner role' }, 403)

    const id = Number(request.getParam('id'))
    if (!Number.isSafeInteger(id) || id < 1) return response.json({ error: 'AI generation id must be a positive integer' }, 422)
    const decision = String(request.get('decision') || '').toLowerCase()
    if (!['approved', 'rejected'].includes(decision)) return response.json({ error: 'Decision must be approved or rejected' }, 422)

    const generation = await AiGeneration.where('id', id).where('team_id', teamId).first()
    if (!generation) return response.json({ error: 'AI generation not found' }, 404)
    if (generation.status !== 'draft') return response.json({ error: `AI generation is already ${generation.status}` }, 409)

    const decidedAt = new Date().toISOString()
    await AiGeneration.forceUpdate(generation.id, {
      status: decision,
      approvedBy: decision === 'approved' ? Number(user.id) : null,
      approvedAt: decision === 'approved' ? decidedAt : null,
    })
    await AuditEvent.forceCreate({
      team_id: teamId,
      user_id: Number(user.id),
      action: `ai_generation.${decision}`,
      subjectType: 'AiGeneration',
      subjectId: String(generation.id),
      metadata: JSON.stringify({ purpose: generation.purpose, model: generation.model }),
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      occurredAt: decidedAt,
    })

    return response.json({ data: await AiGeneration.where('id', id).where('team_id', teamId).first() })
  },
})
