import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import { verifyPublicToken } from './signed-token'

async function channelPreference(teamId: number, channel: 'email' | 'sms', recipient: string) {
  if (!recipient) return { available: false, enabled: false }
  const suppression = await CommunicationSuppression
    .where('team_id', teamId)
    .where('channel', channel)
    .where('recipient', recipient)
    .whereNull('liftedAt')
    .first()
  const consent = await ConsentEvent
    .where('team_id', teamId)
    .where('channel', channel)
    .where('recipient', recipient)
    .orderByDesc('occurredAt')
    .first()

  return {
    available: true,
    enabled: !suppression && !!consent && ['granted', 'confirmed'].includes(String(consent.action)),
  }
}

export default new Action({
  name: 'Public Preferences',
  description: 'Returns consent-aware channel preferences for a signed contact token',
  method: 'GET',
  async handle(request: RequestInstance) {
    const payload = verifyPublicToken(String(request.getParam('token') || ''), String(config.app.key))
    if (!payload || payload.purpose !== 'preferences')
      return response.json({ error: 'Preference link is invalid or expired' }, 400)

    const contact = await Contact.where('id', payload.contactId).where('team_id', payload.teamId).first()
    if (!contact) return response.json({ error: 'Preference link is invalid or expired' }, 400)

    const email = String(contact.email || '').trim().toLowerCase()
    const sms = String(contact.phone || '').trim()
    const [emailPreference, smsPreference] = await Promise.all([
      channelPreference(payload.teamId, 'email', email),
      channelPreference(payload.teamId, 'sms', sms),
    ])

    return response.json({
      contact: { email, phone: sms },
      channels: { email: emailPreference, sms: smsPreference },
    })
  },
})
