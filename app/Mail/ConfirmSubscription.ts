import { config } from '@stacksjs/config'

export interface ConfirmationMessage {
  to: string[]
  from: { name: string, address: string }
  subject: string
  html: string
  text: string
}

export function buildConfirmationMessage(to: string, confirmationUrl: string): ConfirmationMessage {
  const from = config.email.from || { name: 'CommsHQ', address: 'hello@commshq.org' }
  return {
    to: [to],
    from,
    subject: 'Confirm your CommsHQ subscription',
    html: `<p>One quick step remains.</p><p><a href="${confirmationUrl}">Confirm your subscription</a></p><p>If you did not request this, you can ignore this message.</p>`,
    text: `Confirm your subscription: ${confirmationUrl}\n\nIf you did not request this, you can ignore this message.`,
  }
}
