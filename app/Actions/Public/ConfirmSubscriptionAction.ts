import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import { verifyPublicToken } from './signed-token'

export default new Action({
  name: 'Confirm Subscription', description: 'Confirms a double opt-in token', method: 'GET',
  async handle(request: RequestInstance) {
    const payload = verifyPublicToken(String(request.getParam('token') || ''), String(config.app.key))
    if (!payload || payload.purpose !== 'confirm') return response.json({ error: 'Confirmation link is invalid or expired' }, 400)
    const contact = await Contact.where('id', payload.contactId).where('team_id', payload.teamId).first()
    if (!contact) return response.json({ error: 'Confirmation link is invalid or expired' }, 400)
    const recipient = String(payload.channel === 'sms' ? contact.phone : contact.email).trim().toLowerCase()
    const suppression = await CommunicationSuppression
      .where('team_id', payload.teamId)
      .where('channel', payload.channel)
      .where('recipient', recipient)
      .whereNull('liftedAt')
      .first()
    if (suppression) {
      await CommunicationSuppression.forceUpdate(suppression.id, {
        liftedAt: new Date().toISOString(),
      })
    }
    await contact.update({ status: 'active' })
    await ConsentEvent.create({ team_id: payload.teamId, recipient, channel: payload.channel, action: 'confirmed', purpose: 'marketing', source: 'double_opt_in', policyVersion: '1.0', proof: JSON.stringify({ tokenPurpose: payload.purpose }), occurredAt: new Date().toISOString() })
    return response.redirect('/subscription-confirmed')
  },
})
