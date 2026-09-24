import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import { leaveAudiences } from './audience-membership'
import { wantsHtml } from './form-settings'
import { escapeHtml, pageResponse } from './public-response'
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
    if (payload.channel === 'email') {
      await contact.update({ status: 'unsubscribed' })
      await leaveAudiences(payload.teamId, Number(contact.id))
    }
    // The button on the unsubscribe page is a plain form post; a mail
    // client's one-click POST and a script both take JSON.
    if (wantsHtml(request.headers.get('accept')))
      return pageResponse('You are unsubscribed', `<p>${escapeHtml(recipient)} will not get any more emails from this list.</p>`)
    return response.json({ unsubscribed: true })
  },
})
