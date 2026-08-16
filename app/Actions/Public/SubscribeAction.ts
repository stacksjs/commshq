import type { RequestInstance } from '@stacksjs/types'
import { createHash } from 'node:crypto'
import { Action } from '@stacksjs/actions'
import { RateLimiter } from '@stacksjs/auth'
import { config } from '@stacksjs/config'
import { job } from '@stacksjs/queue'
import { response } from '@stacksjs/router'
import Contact from '../../Models/Contact'
import FormDefinition from '../../Models/FormDefinition'
import FormSubmission from '../../Models/FormSubmission'
import { buildConfirmationMessage } from '../../Mail/ConfirmSubscription'
import { createPublicToken } from './signed-token'

function clientIp(request: RequestInstance): string {
  return String(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '').split(',')[0]!.trim()
}

export default new Action({
  name: 'Public Subscribe',
  description: 'Accepts a rate-limited form signup and starts double opt-in',
  method: 'POST',
  async handle(request: RequestInstance) {
    const formKey = String(request.getParam('form') || '')
    const form = await FormDefinition.where('uuid', formKey).where('status', 'active').first()
    if (!form) return response.json({ error: 'Form not found' }, 404)

    const ip = clientIp(request)
    const rateKey = `form:${form.id}:${createHash('sha256').update(ip || 'unknown').digest('hex')}`
    if (await RateLimiter.isRateLimited(rateKey)) return response.json({ error: 'Please wait before trying again' }, 429)
    await RateLimiter.recordFailedAttempt(rateKey)

    const email = String(request.get('email') || '').trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) return response.json({ error: 'A valid email address is required' }, 422)

    const teamId = Number(form.team_id)
    const contact = await Contact.where('team_id', teamId).where('email', email).first()
      ?? await Contact.create({ team_id: teamId, email, firstName: String(request.get('firstName') || ''), lastName: String(request.get('lastName') || ''), status: form.doubleOptIn ? 'pending' : 'active', source: `form:${form.uuid}`, properties: JSON.stringify({}) })

    const dedupeKey = createHash('sha256').update(`${form.id}:${email}:${new Date().toISOString().slice(0, 10)}`).digest('hex')
    const existing = await FormSubmission.where('form_definition_id', form.id).where('dedupeKey', dedupeKey).first()
    if (!existing) await FormSubmission.forceCreate({ team_id: teamId, form_definition_id: form.id, contact_id: contact.id, payload: JSON.stringify({ email, firstName: request.get('firstName'), lastName: request.get('lastName') }), dedupeKey, sourceUrl: request.headers.get('referer') || undefined, ipHash: createHash('sha256').update(ip).digest('hex'), status: form.doubleOptIn ? 'accepted' : 'confirmed' })

    await ConsentEvent.create({ team_id: teamId, recipient: email, channel: 'email', action: form.doubleOptIn ? 'requested' : 'confirmed', purpose: 'marketing', source: `form:${form.uuid}`, jurisdiction: String(request.get('jurisdiction') || ''), policyVersion: '1.0', proof: JSON.stringify({ formId: form.id, userAgent: request.headers.get('user-agent') }), ipAddress: ip, occurredAt: new Date().toISOString() })

    if (form.doubleOptIn) {
      const token = createPublicToken({ teamId, contactId: contact.id, channel: 'email', purpose: 'confirm', expiresAt: Date.now() + 48 * 60 * 60 * 1000 }, String(config.app.key))
      const confirmationUrl = `${String(config.app.url).replace(/\/$/, '')}/confirm/${token}`
      await job('SendEmail', { message: buildConfirmationMessage(email, confirmationUrl), driver: config.email.default }).onQueue('emails').dispatch()
    }

    return response.json({ accepted: true, confirmationRequired: !!form.doubleOptIn }, 202)
  },
})
