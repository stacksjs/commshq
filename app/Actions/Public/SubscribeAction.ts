import type { RequestInstance } from '@stacksjs/types'
import { createHash } from 'node:crypto'
import { Action } from '@stacksjs/actions'
import { RateLimiter } from '@stacksjs/auth'
import { config } from '@stacksjs/config'
import { job } from '@stacksjs/queue'
import Contact from '../../Models/Contact'
import FormDefinition from '../../Models/FormDefinition'
import FormSubmission from '../../Models/FormSubmission'
import { buildConfirmationMessage } from '../../Mail/ConfirmSubscription'
import { joinAudience } from './audience-membership'
import { appendConsentOnce, consentIdempotencyKey } from './consent-ledger'
import { formSender } from './form-sender'
import { originAllowed, parseFormSettings, wantsHtml } from './form-settings'
import { escapeHtml, jsonResponse, pageResponse } from './public-response'
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
    if (!form) return jsonResponse({ error: 'Form not found' }, 404)

    // The router answers CORS itself, for any origin, so a browser can always
    // call this; which sites a form accepts signups from is decided here.
    const settings = parseFormSettings(form.schemaDocument)
    if (!originAllowed(settings, request.headers.get('origin'))) return jsonResponse({ error: 'This form does not accept signups from this site' }, 403)
    // A plain <form> post, with no script to read JSON, gets a page back.
    const html = wantsHtml(request.headers.get('accept'))

    const ip = clientIp(request)
    const rateKey = `form:${form.id}:${createHash('sha256').update(ip || 'unknown').digest('hex')}`
    if (await RateLimiter.isRateLimited(rateKey)) return jsonResponse({ error: 'Please wait before trying again' }, 429)
    await RateLimiter.recordFailedAttempt(rateKey)

    const email = String(request.get('email') || '').trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      if (html) return pageResponse('That address did not look right', '<p>Go back and check the email address, then try again.</p>', 422)
      return jsonResponse({ error: 'A valid email address is required' }, 422)
    }

    const teamId = Number(form.team_id)
    const contact = await Contact.where('team_id', teamId).where('email', email).first()
      ?? await Contact.create({ team_id: teamId, email, firstName: String(request.get('firstName') || ''), lastName: String(request.get('lastName') || ''), status: form.doubleOptIn ? 'pending' : 'active', source: `form:${form.uuid}`, properties: JSON.stringify({}) })

    const dedupeKey = createHash('sha256').update(`${form.id}:${email}:${new Date().toISOString().slice(0, 10)}`).digest('hex')
    const existing = await FormSubmission.where('form_definition_id', form.id).where('dedupeKey', dedupeKey).first()
    if (!existing) await FormSubmission.forceCreate({ team_id: teamId, form_definition_id: form.id, contact_id: contact.id, payload: JSON.stringify({ email, firstName: request.get('firstName'), lastName: request.get('lastName') }), dedupeKey, sourceUrl: request.headers.get('referer') || undefined, ipHash: createHash('sha256').update(ip).digest('hex'), status: form.doubleOptIn ? 'accepted' : 'confirmed' })

    const action = form.doubleOptIn ? 'requested' : 'confirmed'
    const consentKey = consentIdempotencyKey({ scope: `form:${form.id}:${dedupeKey}`, token: email, channel: 'email', action })
    await appendConsentOnce({
      teamId,
      recipient: email,
      channel: 'email',
      action,
      source: `form:${form.uuid}`,
      idempotencyKey: consentKey,
      jurisdiction: String(request.get('jurisdiction') || ''),
      proof: JSON.stringify({ formId: form.id, userAgent: request.headers.get('user-agent') }),
      ipAddress: ip,
    })

    await joinAudience(teamId, form.audience_id ? Number(form.audience_id) : null, Number(contact.id), form.doubleOptIn ? 'pending' : 'active')

    if (form.doubleOptIn) {
      // Number(): Postgres bigint ids arrive as strings, and a token's ids must be integers to verify.
      const token = createPublicToken({ teamId, contactId: Number(contact.id), channel: 'email', purpose: 'confirm', formId: Number(form.id), expiresAt: Date.now() + 48 * 60 * 60 * 1000 }, String(config.app.key))
      const confirmationUrl = `${String(config.app.url).replace(/\/$/, '')}/confirm/${token}`
      const sender = await formSender(teamId, settings.senderIdentityId)
      // No `driver`: the worker sends with the app's configured mailer. The
      // one passed here was `config.email.default`, which is unset, and the
      // queue it went to (`emails`) had no worker reading it either.
      await job('SendEmail', { message: buildConfirmationMessage(email, confirmationUrl, { listName: settings.listName, ...sender }) })
        .withIdempotencyKey(`confirmation:${consentKey}`)
        .onQueue('emails')
        .dispatch()
    }

    if (html) {
      const list = settings.listName ? ` from ${escapeHtml(settings.listName)}` : ''
      return form.doubleOptIn
        ? pageResponse('Check your inbox', `<p>We sent a link to ${escapeHtml(email)}. Click it to confirm, and you will start getting emails${list}.</p>`, 202)
        : pageResponse('You are subscribed', `<p>You will start getting emails${list}.</p>`)
    }
    return jsonResponse({ accepted: true, confirmationRequired: !!form.doubleOptIn }, 202)
  },
})
