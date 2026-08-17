import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { job } from '@stacksjs/queue'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import { buildConfirmationMessage } from '../../Mail/ConfirmSubscription'
import { parsePreferenceChoice } from './preference-policy'
import { createPublicToken, verifyPublicToken } from './signed-token'

async function suppress(teamId: number, channel: 'email' | 'sms', recipient: string): Promise<void> {
  if (!recipient) return
  const existing = await CommunicationSuppression
    .where('team_id', teamId)
    .where('channel', channel)
    .where('recipient', recipient)
    .whereNull('liftedAt')
    .first()
  if (!existing) {
    await CommunicationSuppression.create({
      team_id: teamId,
      recipient,
      channel,
      reason: 'unsubscribe',
      source: 'preference_center',
      suppressedAt: new Date().toISOString(),
    })
  }
  await ConsentEvent.create({
    team_id: teamId,
    recipient,
    channel,
    action: 'revoked',
    purpose: 'marketing',
    source: 'preference_center',
    policyVersion: '1.0',
    proof: JSON.stringify({ signedPreferenceToken: true }),
    occurredAt: new Date().toISOString(),
  })
}

export default new Action({
  name: 'Update Public Preferences',
  description: 'Applies opt-outs and starts verified channel opt-ins',
  method: 'POST',
  async handle(request: RequestInstance) {
    const payload = verifyPublicToken(String(request.getParam('token') || ''), String(config.app.key))
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
      await suppress(payload.teamId, 'email', email)
      await contact.update({ status: 'unsubscribed' })
    }
    else if (wantsEmail === true && email) {
      await ConsentEvent.create({
        team_id: payload.teamId,
        recipient: email,
        channel: 'email',
        action: 'requested',
        purpose: 'marketing',
        source: 'preference_center',
        policyVersion: '1.0',
        proof: JSON.stringify({ signedPreferenceToken: true }),
        occurredAt: new Date().toISOString(),
      })
      const token = createPublicToken({ teamId: payload.teamId, contactId: contact.id, channel: 'email', purpose: 'confirm', expiresAt: Date.now() + 48 * 60 * 60 * 1000 }, String(config.app.key))
      const confirmationUrl = `${String(config.app.url).replace(/\/$/, '')}/confirm/${token}`
      await job('SendEmail', {
        message: buildConfirmationMessage(email, confirmationUrl),
        driver: config.email.default,
      }).onQueue('emails').dispatch()
      result.emailConfirmationRequired = true
    }

    if (wantsSms === false) await suppress(payload.teamId, 'sms', sms)
    else if (wantsSms === true && sms) result.smsStartRequired = true

    if (request.headers.get('accept')?.includes('text/html'))
      return response.redirect('/preferences-saved')

    return response.json({ updated: true, ...result })
  },
})
