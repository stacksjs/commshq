/**
 * The campaigns list, the rows it turns into, and the create and send bodies.
 *
 * Three things here are load-bearing. A new campaign is always a draft, so
 * creating one never sends it. The audience the page names is read the same
 * way the dispatch action reads it. And the Send control is offered only
 * from the statuses that action accepts.
 */
import { describe, expect, test } from 'bun:test'
import {
  audienceIdOf,
  audiencesUrl,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_NAME_MAX,
  CAMPAIGN_SUBJECT_MAX,
  campaignPayload,
  CAMPAIGNS_ENDPOINT,
  CAMPAIGNS_PER_PAGE,
  campaignsUrl,
  campaignUrl,
  channelLabel,
  dispatchErrorMessage,
  dispatchResultMessage,
  dispatchUrl,
  draftError,
  EVERY_CONTACT_LABEL,
  listErrorMessage,
  saveErrorMessage,
  statusLabel,
  toAudienceOptions,
  toCampaignView,
  toCampaignViews,
  toSenderOptions,
  verifiedSendersUrl,
} from '../../resources/data/campaigns-query'

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

const AUDIENCES = [{ id: 5, name: 'Weekly readers' }, { id: 8, name: 'Product updates' }]

describe('the requests', () => {
  test('it lists from the endpoint the framework model publishes, newest first', () => {
    expect(CAMPAIGNS_ENDPOINT).toBe('/api/campaigns')
    expect(params(campaignsUrl())).toEqual({ per_page: String(CAMPAIGNS_PER_PAGE), sort: '-created_at,-id' })
  })

  test('status is an equality filter, and an empty one is not sent', () => {
    expect(params(campaignsUrl({ status: 'draft', page: 3 }))).toMatchObject({ status: 'draft', page: '3' })
    expect(params(campaignsUrl({ status: '' }))).not.toHaveProperty('status')
  })

  test('one campaign is addressed by its id, and sent through the app route', () => {
    expect(campaignUrl(12)).toBe('/api/campaigns/12')
    expect(dispatchUrl(12)).toBe('/api/v1/campaigns/12/dispatch')
  })

  test('the dispatch address is the route routes/api.ts registers', async () => {
    const routes = await Bun.file(new URL('../../routes/api.ts', import.meta.url)).text()
    expect(routes).toContain("route.post('/v1/campaigns/{id}/dispatch'")
  })

  test('the framework model is named in the API selection, or the list is a 404', async () => {
    const security = await Bun.file(new URL('../../config/security.ts', import.meta.url)).text()
    expect(security).toMatch(/models:\s*\[[^\]]*'own'[^\]]*'Campaign'/)
  })

  test('audiences for the picker come by name', () => {
    expect(params(audiencesUrl())).toEqual({ per_page: '100', sort: 'name,id' })
  })
})

describe('the audience a campaign is for', () => {
  test('it is segment_definition.audienceId, as a string or an object', () => {
    expect(audienceIdOf('{"audienceId":5}')).toBe(5)
    expect(audienceIdOf({ audienceId: '8' })).toBe(8)
  })

  test('anything else means no audience, the way the dispatch action reads it', () => {
    for (const value of [null, undefined, '', 'not json', '{"operator":"and","rules":[]}', { audienceId: 0 }, { audienceId: -2 }, { audienceId: 1.5 }])
      expect(audienceIdOf(value)).toBeUndefined()
  })

  test('the action reads the same field with the same rule', async () => {
    const action = await Bun.file(new URL('../../app/Actions/Api/V1/DispatchCampaignAction.ts', import.meta.url)).text()
    expect(action).toContain('Number((doc as any)?.audienceId)')
    expect(action).toContain('Number.isInteger(id) && id > 0 ? id : undefined')
  })

  test('picker options fall back to the id when a name is blank', () => {
    expect(toAudienceOptions({ data: [{ id: 5, name: ' Weekly readers ' }, { id: 9, name: '' }] })).toEqual([
      { id: 5, name: 'Weekly readers' },
      { id: 9, name: 'Audience 9' },
    ])
    expect(toAudienceOptions(null)).toEqual([])
  })
})

describe('a row on the list', () => {
  test('an email draft shows its subject and its audience by name', () => {
    const view = toCampaignView({ id: 1, name: 'Sunday issue', type: 'email', status: 'draft', subject: 'A calmer week', segment_definition: '{"audienceId":5}', updated_at: '2026-11-10T09:00:00Z' }, AUDIENCES, 'en-US')
    expect(view).toMatchObject({ name: 'Sunday issue', channelLabel: 'Email', statusLabel: 'Draft', summary: 'A calmer week', audienceLabel: 'Weekly readers', whenLabel: 'Last changed Nov 10, 2026' })
  })

  test('an SMS shows the opening of its message, cut to length', () => {
    const view = toCampaignView({ id: 2, type: 'sms', status: 'draft', text: 'x'.repeat(300) })
    expect(view.channelLabel).toBe('SMS')
    expect(view.summary).toHaveLength(120)
    expect(view.summary.endsWith('...')).toBe(true)
  })

  test('no audience is said in words, and an unknown one by its id', () => {
    expect(toCampaignView({ id: 3 }, AUDIENCES).audienceLabel).toBe(EVERY_CONTACT_LABEL)
    expect(toCampaignView({ id: 3, segment_definition: { audienceId: 77 } }, AUDIENCES).audienceLabel).toBe('Audience 77')
  })

  test('the date it shows is the sent date, then the scheduled one', () => {
    expect(toCampaignView({ id: 4, status: 'sent', sent_at: '2026-11-01T12:00:00Z', scheduled_at: '2026-10-30T12:00:00Z' }, [], 'en-US').whenLabel).toBe('Sent Nov 1, 2026')
    expect(toCampaignView({ id: 4, status: 'scheduled', scheduled_at: '2026-12-01T12:00:00Z' }, [], 'en-US').whenLabel).toBe('Scheduled for Dec 1, 2026')
  })

  test('Send is offered only from the statuses the dispatch action accepts', async () => {
    const action = await Bun.file(new URL('../../app/Actions/Api/V1/DispatchCampaignAction.ts', import.meta.url)).text()
    expect(action).toContain("['draft', 'scheduled', 'paused'].includes(String(campaign.status))")

    const sendable = ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'failed'].filter(status => toCampaignView({ id: 5, status }).canSend)
    expect(sendable).toEqual(['draft', 'scheduled', 'paused'])
  })

  test('a finished campaign offers nothing', () => {
    for (const status of ['sent', 'cancelled', 'failed'])
      expect(toCampaignView({ id: 6, status })).toMatchObject({ canSend: false, canPause: false, canCancel: false })
    expect(toCampaignView({ id: 6, status: 'sending' })).toMatchObject({ canSend: false, canPause: true, canCancel: true })
  })

  test('labels cover the unknown and the missing', () => {
    expect(channelLabel('multi-channel')).toBe('Multi channel')
    expect(channelLabel(null)).toBe('Unknown')
    expect(statusLabel('archived')).toBe('Archived')
    expect(toCampaignViews(null)).toEqual([])
    expect(toCampaignView({ id: 7, name: ' ' }).name).toBe('Campaign 7')
  })
})

describe('creating one', () => {
  const draft = { name: 'Sunday issue', channel: 'email', subject: 'A calmer week', text: 'Hello', audienceId: '5' }

  test('a complete draft has no error', () => {
    expect(draftError(draft)).toBe('')
    expect(draftError({ name: 'Flash text', channel: 'sms', text: 'Doors open at 9' })).toBe('')
  })

  test('it holds the name, subject and message to the model limits', () => {
    expect(draftError({ ...draft, name: 'ab' })).toContain('at least 3')
    expect(draftError({ ...draft, name: 'n'.repeat(CAMPAIGN_NAME_MAX + 1) })).toContain(`at most ${CAMPAIGN_NAME_MAX}`)
    expect(draftError({ ...draft, subject: ' ' })).toContain('subject line')
    expect(draftError({ ...draft, subject: 's'.repeat(CAMPAIGN_SUBJECT_MAX + 1) })).toContain(`at most ${CAMPAIGN_SUBJECT_MAX}`)
    expect(draftError({ ...draft, text: '' })).toContain('message')
  })

  test('the body is always a draft', () => {
    expect(campaignPayload(draft)).toEqual({ name: 'Sunday issue', type: 'email', status: 'draft', subject: 'A calmer week', text: 'Hello', segment_definition: '{"audienceId":5}' })
  })

  test('an SMS carries no subject, and no audience means no segment definition', () => {
    const payload = campaignPayload({ name: 'Flash text', channel: 'sms', subject: 'ignored', text: 'Doors open at 9', audienceId: '' })
    expect(payload).toEqual({ name: 'Flash text', type: 'sms', status: 'draft', text: 'Doors open at 9' })
  })

  test('only the channels the job delivers are offered', () => {
    expect(CAMPAIGN_CHANNELS.map(item => item.value)).toEqual(['email', 'sms'])
    expect(campaignPayload({ ...draft, channel: 'push' }).type).toBe('email')
  })
})

describe('who an email comes from', () => {
  const maya = { name: 'Maya', address: 'maya@example.com', replyTo: 'replies@example.com' }

  test('the picker asks for verified email senders', () => {
    expect(params(verifiedSendersUrl())).toEqual({ per_page: '50', channel: 'email', status: 'verified', sort: 'name,id' })
    expect(verifiedSendersUrl().startsWith('/api/v1/sender-identities?')).toBe(true)
  })

  test('only verified senders with an address become options', () => {
    const options = toSenderOptions({ data: [
      { id: 1, name: 'Maya', address: 'maya@example.com', reply_to: 'replies@example.com', status: 'verified' },
      { id: 2, name: 'Waiting', address: 'w@example.org', status: 'pending' },
      { id: 3, name: 'No address', address: ' ', status: 'verified' },
      { id: 4, name: '', address: 'bare@example.com', status: 'verified' },
    ] })
    expect(options).toEqual([
      { id: 1, name: 'Maya', address: 'maya@example.com', replyTo: 'replies@example.com', label: 'Maya <maya@example.com>' },
      { id: 4, name: 'bare@example.com', address: 'bare@example.com', replyTo: '', label: 'bare@example.com' },
    ])
    expect(toSenderOptions(null)).toEqual([])
  })

  test('a picked sender is copied onto an email campaign', () => {
    expect(campaignPayload({ name: 'Sunday issue', channel: 'email', subject: 'Hi', text: 'Hello', sender: maya })).toMatchObject({ from_name: 'Maya', from_address: 'maya@example.com', reply_to: 'replies@example.com' })
  })

  test('no sender leaves the From off the row, and SMS never carries one', () => {
    const email = campaignPayload({ name: 'Sunday issue', channel: 'email', subject: 'Hi', text: 'Hello', sender: null })
    for (const key of ['from_name', 'from_address', 'reply_to'])
      expect(email).not.toHaveProperty(key)
    const sms = campaignPayload({ name: 'Flash text', channel: 'sms', text: 'Doors open at 9', sender: maya })
    expect(sms).toEqual({ name: 'Flash text', type: 'sms', status: 'draft', text: 'Doors open at 9' })
  })

  test('a row says which address it will use', () => {
    expect(toCampaignView({ id: 1, type: 'email', from_name: 'Maya', from_address: 'maya@example.com' }).fromLabel).toBe('Maya <maya@example.com>')
    expect(toCampaignView({ id: 1, type: 'email' }).fromLabel).toBe('The workspace default address')
    expect(toCampaignView({ id: 1, type: 'sms', from_address: 'maya@example.com' }).fromLabel).toBe('')
  })

  test('the columns written are the ones the send job reads', async () => {
    const job = await Bun.file(new URL('../../app/Jobs/DispatchCampaign.ts', import.meta.url)).text()
    for (const field of ['campaign.fromAddress', 'campaign.fromName', 'campaign.replyTo'])
      expect(job).toContain(field)
    // The guard that makes the picker a convenience and not the protection.
    expect(job).toContain("SenderDomain.where('team_id', payload.teamId).where('domain', domain).where('status', 'verified')")
  })
})

describe('what it says back', () => {
  test('a send reports how many were queued', () => {
    expect(dispatchResultMessage({ queued: 1 })).toContain('1 recipient.')
    expect(dispatchResultMessage({ queued: 240 })).toContain('240 recipients.')
    expect(dispatchResultMessage({ queued: 0 })).toContain('Nothing was queued')
    expect(dispatchResultMessage(null)).toContain('Nothing was queued')
  })

  test('each failure names what happened', () => {
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(503)).toContain('not answering')
    expect(saveErrorMessage(422)).toContain('invalid')
    expect(saveErrorMessage(404)).toContain('no longer exists')
    expect(dispatchErrorMessage(409)).toContain('current status')
    expect(dispatchErrorMessage(429)).toContain('Wait a minute')
    expect(dispatchErrorMessage(500)).toContain('(500)')
  })
})
