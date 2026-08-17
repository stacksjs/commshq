import { describe, expect, it } from 'bun:test'
import { twilioComplianceXml, twilioConsentIdempotencyKey } from '../../app/Actions/Webhooks/twilio-compliance'

describe('Twilio compliance responses', () => {
  it('returns provider-ready TwiML for every compliance keyword', () => {
    expect(twilioComplianceXml('STOP')).toContain('<Message>CommsHQ: you are unsubscribed.')
    expect(twilioComplianceXml('START')).toContain('<Message>CommsHQ: you are resubscribed.')
    expect(twilioComplianceXml('HELP')).toContain('support@commshq.org')
  })

  it('acknowledges non-compliance messages without sending an automatic reply', () => {
    expect(twilioComplianceXml('What time is the launch?')).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  })

  it('derives a stable consent key from the provider event', () => {
    expect(twilioConsentIdempotencyKey('SM123')).toBe('twilio:SM123:consent')
  })
})
