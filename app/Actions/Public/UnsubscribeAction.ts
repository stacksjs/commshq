import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import { verifyPublicToken } from './signed-token'

export default new Action({
  name: 'Public Unsubscribe', description: 'Applies one-click channel suppression', method: 'POST',
  async handle(request: RequestInstance) {
    const payload = verifyPublicToken(String(request.getParam('token') || ''), String(config.app.key))
    if (!payload || !['unsubscribe', 'preferences'].includes(payload.purpose)) return response.json({ error: 'Unsubscribe link is invalid or expired' }, 400)
    const contact = await Contact.where('id', payload.contactId).where('team_id', payload.teamId).first()
    if (!contact) return response.json({ error: 'Unsubscribe link is invalid or expired' }, 400)
    const recipient = String(payload.channel === 'sms' ? contact.phone : contact.email).trim().toLowerCase()
    const existing = await CommunicationSuppression.where('team_id', payload.teamId).where('channel', payload.channel).where('recipient', recipient).first()
    if (!existing) await CommunicationSuppression.create({ team_id: payload.teamId, recipient, channel: payload.channel, reason: 'unsubscribe', source: 'one_click', suppressedAt: new Date().toISOString() })
    await ConsentEvent.create({ team_id: payload.teamId, recipient, channel: payload.channel, action: 'revoked', purpose: 'marketing', source: 'one_click', policyVersion: '1.0', proof: JSON.stringify({ tokenPurpose: payload.purpose }), occurredAt: new Date().toISOString() })
    if (payload.channel === 'email') await contact.update({ status: 'unsubscribed' })
    return response.json({ unsubscribed: true })
  },
})
