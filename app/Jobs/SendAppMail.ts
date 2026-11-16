import { Job } from '@stacksjs/queue'
import { senderForApp } from '../Hq/apps'
import { canSignOutbound, sqlAppStore, transport } from '../Hq/service'

interface Payload {
  message: { to: string[], from?: { name: string, address: string }, replyTo?: string, subject: string, html?: string, text?: string }
  teamId: number
  appId: string
}

/**
 * Mail CommsHQ writes for a connected app: a signup form's confirmation.
 *
 * Sent from the app's own address, signed with its domain's key, once that
 * domain is ready, so the reader hears from the site they signed up on.
 * The key is read here, when the message is sent, and never rides in the
 * queue. Until the domain is ready the message goes out as it was built, from
 * CommsHQ.
 */
export default new Job({
  name: 'SendAppMail', description: 'Sends mail CommsHQ writes for a connected app from the app\'s own domain', queue: 'emails', tries: 5, backoff: [30, 120, 600],
  async handle(payload: Payload) {
    const { message } = payload
    const sender = await senderForApp(sqlAppStore, Number(payload.teamId), String(payload.appId), canSignOutbound).catch(() => null)
    const base = {
      to: message.to,
      cc: [],
      bcc: [],
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: {},
    }
    if (sender) {
      const own = await transport({ ...base, from: sender.from, replyTo: message.replyTo ? [message.replyTo] : [], signing: sender.signing })
      if (own.ok)
        return { from: sender.from.address }
    }
    // Not ready, or the mail server would not carry it: from CommsHQ, with
    // replies to the app's address where it has one.
    const from = message.from ?? { name: 'CommsHQ', address: 'hello@commshq.org' }
    const shared = await transport({ ...base, from, replyTo: message.replyTo ? [message.replyTo] : (sender ? [sender.from.address] : []) })
    if (!shared.ok)
      throw new Error(shared.error || 'The mail server did not accept the message')
    return { from: from.address }
  },
})
