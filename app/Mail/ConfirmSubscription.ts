import { config } from '@stacksjs/config'

export interface ConfirmationMessage {
  to: string[]
  from: { name: string, address: string }
  replyTo?: string
  subject: string
  html: string
  text: string
}

export interface ConfirmationOptions {
  /** The list as the subscriber knows it, e.g. "Chris Breuer". */
  listName?: string
  /** The form's sender; the workspace default when absent. */
  from?: { name: string, address: string }
  replyTo?: string
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The double opt-in email.
 *
 * It comes from the list, not from CommsHQ: someone who signed up on
 * chrisbreuer.me is expecting Chris Breuer, and an unfamiliar sender asking
 * them to click a link reads as phishing and gets deleted. So a form's list
 * name and sender are used when it has them.
 */
export function buildConfirmationMessage(to: string, confirmationUrl: string, options: ConfirmationOptions = {}): ConfirmationMessage {
  const from = options.from ?? config.email.from ?? { name: 'CommsHQ', address: 'hello@commshq.org' }
  const list = options.listName
  const subject = list ? `Confirm your subscription to ${list}` : 'Confirm your subscription'
  const lead = list
    ? `You asked to get emails from ${escapeHtml(list)}. One click confirms it.`
    : 'One quick step remains.'
  const url = escapeHtml(confirmationUrl)

  return {
    to: [to],
    from: { name: String(from.name || 'CommsHQ'), address: String(from.address) },
    replyTo: options.replyTo || undefined,
    subject,
    html: `<p>${lead}</p><p><a href="${url}">Confirm your subscription</a></p><p>If you did not ask for this, ignore this email and you will not hear from us again.</p>`,
    text: `${list ? `You asked to get emails from ${list}. ` : ''}Confirm your subscription:\n${confirmationUrl}\n\nIf you did not ask for this, ignore this email and you will not hear from us again.`,
  }
}
