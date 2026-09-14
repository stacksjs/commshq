import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import { appendConsentOnce, consentIdempotencyKey, consentStateMatches, ensureSuppressed, findActiveSuppression, findLatestConsent } from './consent-ledger'
import { verifyPublicToken } from './signed-token'

export default new Action({
  name: 'Public Unsubscribe', description: 'Applies one-click channel suppression', method: 'POST',
  async handle(request: RequestInstance) {
    const rawToken = String(request.getParam('token') || '')
    const payload = verifyPublicToken(rawToken, String(config.app.key))
    if (!payload || !['unsubscribe', 'preferences'].includes(payload.purpose)) return response.json({ error: 'Unsubscribe link is invalid or expired' }, 400)
    const contact = await Contact.where('id', payload.contactId).where('team_id', payload.teamId).first()
    if (!contact) return response.json({ error: 'Unsubscribe link is invalid or expired' }, 400)
    const recipient = String(payload.channel === 'sms' ? contact.phone : contact.email).trim().toLowerCase()
    const [activeSuppression, latestConsent] = await Promise.all([
      findActiveSuppression(payload.teamId, payload.channel, recipient),
      findLatestConsent(payload.teamId, payload.channel, recipient),
    ])
    const alreadyApplied = !!activeSuppression && consentStateMatches(latestConsent, 'revoked', 'one_click')

    await ensureSuppressed({ teamId: payload.teamId, recipient, channel: payload.channel, source: 'one_click' })
    if (!alreadyApplied) {
      await appendConsentOnce({
        teamId: payload.teamId,
        recipient,
        channel: payload.channel,
        action: 'revoked',
        source: 'one_click',
        idempotencyKey: consentIdempotencyKey({ scope: 'unsubscribe', token: rawToken, channel: payload.channel, action: 'revoked', predecessorId: latestConsent?.id }),
        proof: JSON.stringify({ tokenPurpose: payload.purpose }),
      })
    }
    if (payload.channel === 'email') await contact.update({ status: 'unsubscribed' })
    return response.json({ unsubscribed: true })
  },
})
