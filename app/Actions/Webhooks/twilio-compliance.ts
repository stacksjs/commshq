import { classifySmsIntent, smsComplianceReply } from '@stacksjs/sms'

const complianceOptions = {
  appName: 'CommsHQ',
  helpContact: 'support@commshq.org',
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function twilioComplianceXml(body: string): string {
  const { intent } = classifySmsIntent(body)
  const reply = smsComplianceReply(intent, complianceOptions)
  const message = reply ? `<Message>${escapeXml(reply)}</Message>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${message}</Response>`
}

export function twilioConsentIdempotencyKey(providerEventId: string): string {
  return `twilio:${providerEventId}:consent`
}
