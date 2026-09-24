import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import FormDefinition from '../../Models/FormDefinition'
import { joinAudience } from './audience-membership'
import { appendConsentOnce, consentIdempotencyKey, findConsentByKey } from './consent-ledger'
import { parseFormSettings } from './form-settings'
import { pageResponse } from './public-response'
import { verifyPublicToken } from './signed-token'

/**
 * Where a confirmed subscriber lands: the form's own success page when it has
 * one, so someone who signed up on chrisbreuer.me ends up back there, and
 * CommsHQ's generic page otherwise.
 */
async function landing(teamId: number, formId: number | undefined): Promise<{ url: string, form: any }> {
  const form = formId ? await FormDefinition.where('id', formId).where('team_id', teamId).first() : null
  const settings = form ? parseFormSettings(form.schemaDocument) : undefined
  return { url: settings?.successUrl || '/subscription-confirmed', form }
}

export default new Action({
  name: 'Confirm Subscription', description: 'Confirms a double opt-in token', method: 'GET',
  async handle(request: RequestInstance) {
    const rawToken = String(request.getParam('token') || '')
    const payload = verifyPublicToken(rawToken, String(config.app.key))
    // A person clicked this in an email, so a failure is a page, not JSON.
    const expired = () => pageResponse('This link has expired', '<p>Confirmation links last 48 hours. Sign up again and we will send a fresh one.</p>', 400)
    if (!payload || payload.purpose !== 'confirm') return expired()
    const contact = await Contact.where('id', payload.contactId).where('team_id', payload.teamId).first()
    if (!contact) return expired()
    const { url: landingUrl, form } = await landing(payload.teamId, payload.formId)
    const recipient = String(payload.channel === 'sms' ? contact.phone : contact.email).trim().toLowerCase()
    const idempotencyKey = consentIdempotencyKey({ scope: 'confirm', token: rawToken, channel: payload.channel, action: 'confirmed' })
    if (await findConsentByKey(payload.teamId, idempotencyKey)) return response.redirect(landingUrl)
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
    if (form) await joinAudience(payload.teamId, form.audience_id ? Number(form.audience_id) : null, Number(contact.id), 'active')
    await appendConsentOnce({ teamId: payload.teamId, recipient, channel: payload.channel, action: 'confirmed', source: 'double_opt_in', idempotencyKey, proof: JSON.stringify({ tokenPurpose: payload.purpose, formId: payload.formId }) })
    return response.redirect(landingUrl)
  },
})
