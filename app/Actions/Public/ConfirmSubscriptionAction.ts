import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import { appendConsentOnce, consentIdempotencyKey, findConsentByKey } from './consent-ledger'
import { verifyPublicToken } from './signed-token'

export default new Action({
  name: 'Confirm Subscription', description: 'Confirms a double opt-in token', method: 'GET',
  async handle(request: RequestInstance) {
    const rawToken = String(request.getParam('token') || '')
    const payload = verifyPublicToken(rawToken, String(config.app.key))
    if (!payload || payload.purpose !== 'confirm') return response.json({ error: 'Confirmation link is invalid or expired' }, 400)
    const contact = await Contact.where('id', payload.contactId).where('team_id', payload.teamId).first()
    if (!contact) return response.json({ error: 'Confirmation link is invalid or expired' }, 400)
    const recipient = String(payload.channel === 'sms' ? contact.phone : contact.email).trim().toLowerCase()
    const idempotencyKey = consentIdempotencyKey({ scope: 'confirm', token: rawToken, channel: payload.channel, action: 'confirmed' })
    if (await findConsentByKey(payload.teamId, idempotencyKey)) return response.redirect('/subscription-confirmed')
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
    await appendConsentOnce({ teamId: payload.teamId, recipient, channel: payload.channel, action: 'confirmed', source: 'double_opt_in', idempotencyKey, proof: JSON.stringify({ tokenPurpose: payload.purpose }) })
    return response.redirect('/subscription-confirmed')
  },
})
