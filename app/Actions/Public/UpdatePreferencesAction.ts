import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { job } from '@stacksjs/queue'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import { buildConfirmationMessage } from '../../Mail/ConfirmSubscription'
import { appendConsentOnce, consentIdempotencyKey, consentStateMatches, ensureSuppressed, findActiveSuppression, findLatestConsent } from './consent-ledger'
import { parsePreferenceChoice } from './preference-policy'
import { createPublicToken, verifyPublicToken } from './signed-token'

async function suppress(teamId: number, channel: 'email' | 'sms', recipient: string, token: string): Promise<void> {
  if (!recipient) return
  const [activeSuppression, latestConsent] = await Promise.all([
    findActiveSuppression(teamId, channel, recipient),
    findLatestConsent(teamId, channel, recipient),
  ])
  const alreadyApplied = !!activeSuppression && consentStateMatches(latestConsent, 'revoked', 'preference_center')

  await ensureSuppressed({ teamId, recipient, channel, source: 'preference_center' })
  if (alreadyApplied) return
  await appendConsentOnce({
    teamId,
    recipient,
    channel,
    action: 'revoked',
    source: 'preference_center',
    idempotencyKey: consentIdempotencyKey({ scope: 'preferences', token, channel, action: 'revoked', predecessorId: latestConsent?.id }),
    proof: JSON.stringify({ signedPreferenceToken: true }),
  })
}

export default new Action({
  name: 'Update Public Preferences',
  description: 'Applies opt-outs and starts verified channel opt-ins',
  method: 'POST',
  async handle(request: RequestInstance) {
    const rawToken = String(request.getParam('token') || '')
    const payload = verifyPublicToken(rawToken, String(config.app.key))
    if (!payload || payload.purpose !== 'preferences')
      return response.json({ error: 'Preference link is invalid or expired' }, 400)

    const contact = await Contact.where('id', payload.contactId).where('team_id', payload.teamId).first()
    if (!contact) return response.json({ error: 'Preference link is invalid or expired' }, 400)

    const email = String(contact.email || '').trim().toLowerCase()
    const sms = String(contact.phone || '').trim()
    const wantsEmail = parsePreferenceChoice(request.get('email'))
    const wantsSms = parsePreferenceChoice(request.get('sms'))
    const result = { emailConfirmationRequired: false, smsStartRequired: false }

    if (wantsEmail === false) {
      await suppress(payload.teamId, 'email', email, rawToken)
      await contact.update({ status: 'unsubscribed' })
    }
    else if (wantsEmail === true && email) {
      const [activeSuppression, latestConsent] = await Promise.all([
        findActiveSuppression(payload.teamId, 'email', email),
        findLatestConsent(payload.teamId, 'email', email),
      ])
      const alreadyRequested = consentStateMatches(latestConsent, 'requested', 'preference_center')
      const alreadyEnabled = !activeSuppression && !!latestConsent && ['granted', 'confirmed'].includes(String(latestConsent.action))
      const transitionKey = consentIdempotencyKey({ scope: 'preferences', token: rawToken, channel: 'email', action: 'requested', predecessorId: latestConsent?.id })
      const requestKey = alreadyRequested
        ? String(latestConsent.idempotencyKey || latestConsent.idempotency_key || transitionKey)
        : transitionKey
      const created = alreadyRequested || alreadyEnabled ? false : await appendConsentOnce({
        teamId: payload.teamId,
        recipient: email,
        channel: 'email',
        action: 'requested',
        source: 'preference_center',
        idempotencyKey: requestKey,
        proof: JSON.stringify({ signedPreferenceToken: true }),
      })
      if (created || alreadyRequested) {
        result.emailConfirmationRequired = true
        const token = createPublicToken({ teamId: payload.teamId, contactId: contact.id, channel: 'email', purpose: 'confirm', expiresAt: Date.now() + 48 * 60 * 60 * 1000 }, String(config.app.key))
        const confirmationUrl = `${String(config.app.url).replace(/\/$/, '')}/confirm/${token}`
        await job('SendEmail', {
          message: buildConfirmationMessage(email, confirmationUrl),
          driver: config.email.default,
        })
          .withIdempotencyKey(`confirmation:${requestKey}`)
          .onQueue('emails')
          .dispatch()
      }
    }

    if (wantsSms === false) await suppress(payload.teamId, 'sms', sms, rawToken)
    else if (wantsSms === true && sms) result.smsStartRequired = true

    if (request.headers.get('accept')?.includes('text/html'))
      return response.redirect('/preferences-saved')

    return response.json({ updated: true, ...result })
  },
})
