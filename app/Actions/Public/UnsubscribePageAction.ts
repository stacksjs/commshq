import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import Contact from '../../Models/Contact'
import { escapeHtml, pageResponse } from './public-response'
import { verifyPublicToken } from './signed-token'

/**
 * What the unsubscribe link in an email opens.
 *
 * It asks rather than acts. Mail providers and link scanners fetch every URL
 * in a message before anyone reads it, so a GET that unsubscribed would take
 * people off lists they never left. The button posts to the same URL, which
 * is also where RFC 8058 one-click unsubscribe from a mail client lands.
 */
export default new Action({
  name: 'Public Unsubscribe Page',
  description: 'Shows the confirm button for an unsubscribe link',
  method: 'GET',
  async handle(request: RequestInstance) {
    const rawToken = String(request.getParam('token') || '')
    const payload = verifyPublicToken(rawToken, String(config.app.key))
    const contact = payload && ['unsubscribe', 'preferences'].includes(payload.purpose)
      ? await Contact.where('id', payload.contactId).where('team_id', payload.teamId).first()
      : null
    if (!payload || !contact)
      return pageResponse('This link has expired', '<p>Reply to any email you got from us and ask to be removed, and we will take care of it.</p>', 400)

    const address = String(payload.channel === 'sms' ? contact.phone : contact.email)
    if (contact.status === 'unsubscribed' && payload.channel === 'email')
      return pageResponse('You are unsubscribed', `<p>${escapeHtml(address)} is not on this list any more.</p>`)

    return pageResponse(
      'Unsubscribe?',
      `<p>Stop sending emails to ${escapeHtml(address)}.</p><form method="post" action="/unsubscribe/${escapeHtml(encodeURIComponent(rawToken))}"><button type="submit">Unsubscribe</button></form>`,
    )
  },
})
