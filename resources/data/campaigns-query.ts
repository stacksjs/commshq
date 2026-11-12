/**
 * Reading, creating and sending campaigns through the application's own API.
 *
 * Sending was already real: `POST /api/v1/campaigns/{id}/dispatch` snapshots
 * the audience into `campaign_recipients` and queues the `DispatchCampaign`
 * job, which checks consent and suppression per recipient before anything
 * leaves. What was missing was any way to see or create a campaign: the page
 * was a static composer showing a "Sunday Dispatch" draft, an audience
 * snapshot of 24,816 and a best send window, none of it read from anywhere.
 *
 * `Campaign` is the framework's model, not one of the app's, and generated
 * APIs default to the app's own models. `config/security.ts` names it, which
 * publishes its CRUD at `/api/campaigns` behind `auth` and `team`. That is
 * why this endpoint has no `v1` segment while the dispatch route beside it
 * does: one is generated from the framework model, the other is the app's.
 *
 * ## What the page does not show
 *
 * No open, click or conversion rate, no audience size and no sent count. The
 * columns exist on the row, but nothing in the send path writes them: the job
 * records each delivery in `campaign_sends` and sets the status, and that is
 * all. Showing the columns would show zeroes that read as results.
 *
 * No scheduling either. The dispatch action honours `scheduled_at`, but the
 * page would have to settle which timezone a typed time is in, and a send at
 * the wrong hour is not something to get approximately right.
 */
import { formatSeen } from './contacts-query'

export const CAMPAIGNS_ENDPOINT = '/api/campaigns'
export const CAMPAIGN_DISPATCH_PREFIX = '/api/v1/campaigns'
export const AUDIENCES_ENDPOINT = '/api/v1/audiences'
export const CAMPAIGNS_PER_PAGE = 25
/** One request's worth of audiences for the picker. */
export const AUDIENCES_PER_PAGE = 100

/** The limits the model's own validation declares. */
export const CAMPAIGN_NAME_MIN = 3
export const CAMPAIGN_NAME_MAX = 255
export const CAMPAIGN_SUBJECT_MAX = 255

/**
 * The two channels the dispatch job delivers. The model also allows `push`,
 * `social` and `multi-channel`, but the job treats anything that is not `sms`
 * as email, so offering them would create a campaign that sends as something
 * other than what it says.
 */
export const CAMPAIGN_CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
] as const

export const CAMPAIGN_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'sending', label: 'Sending' },
  { value: 'sent', label: 'Sent' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'failed', label: 'Failed' },
] as const

/** The statuses `DispatchCampaignAction` accepts; anything else is a 409. */
export const DISPATCHABLE_STATUSES = ['draft', 'scheduled', 'paused'] as const
/** A send in flight or waiting can be held; the job stops between recipients. */
export const PAUSABLE_STATUSES = ['scheduled', 'sending'] as const
/** Anything not already finished can be called off. */
export const CANCELLABLE_STATUSES = ['draft', 'scheduled', 'sending', 'paused'] as const

export const EVERY_CONTACT_LABEL = 'Every active contact'

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function channelLabel(type?: string | null): string {
  const known = CAMPAIGN_CHANNELS.find(item => item.value === type)
  return known ? known.label : (type ? titleCase(String(type)) : 'Unknown')
}

export function statusLabel(status?: string | null): string {
  const known = CAMPAIGN_STATUSES.find(item => item.value === status)
  return known ? known.label : (status ? titleCase(String(status)) : 'Unknown')
}

/**
 * Build the listing URL.
 *
 * Newest first, then by id. Campaign names are not unique, and two created
 * in the same instant must still land on one page each.
 */
export function campaignsUrl(query: { page?: number, perPage?: number, status?: string } = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? CAMPAIGNS_PER_PAGE))))
  if (query.status)
    params.set('status', query.status)
  params.set('sort', '-created_at,-id')
  return `${CAMPAIGNS_ENDPOINT}?${params.toString()}`
}

export function campaignUrl(id: number): string {
  return `${CAMPAIGNS_ENDPOINT}/${Math.trunc(Number(id))}`
}

export function dispatchUrl(id: number): string {
  return `${CAMPAIGN_DISPATCH_PREFIX}/${Math.trunc(Number(id))}/dispatch`
}

export function audiencesUrl(): string {
  const params = new URLSearchParams()
  params.set('per_page', String(AUDIENCES_PER_PAGE))
  params.set('sort', 'name,id')
  return `${AUDIENCES_ENDPOINT}?${params.toString()}`
}

/**
 * The audience a campaign is for, from `segment_definition.audienceId`.
 *
 * The same reading `DispatchCampaignAction` does: a positive integer id, and
 * anything else means no audience, which the action sends to every active
 * contact. The two must agree, or the page would name one audience while the
 * send went to another.
 */
export function audienceIdOf(segmentDefinition: unknown): number | undefined {
  try {
    const doc = typeof segmentDefinition === 'string' ? JSON.parse(segmentDefinition) : segmentDefinition
    const id = Number((doc as { audienceId?: unknown } | null)?.audienceId)
    return Number.isInteger(id) && id > 0 ? id : undefined
  }
  catch {
    return undefined
  }
}

export interface AudienceRow {
  id: number
  name?: string | null
}

export interface AudienceOption {
  id: number
  name: string
}

export function toAudienceOptions(body: { data?: AudienceRow[] } | null | undefined): AudienceOption[] {
  return (body?.data ?? []).map(row => ({ id: Number(row.id), name: (row.name || '').trim() || `Audience ${row.id}` }))
}

export interface CampaignRow {
  id: number
  name?: string | null
  type?: string | null
  status?: string | null
  subject?: string | null
  text?: string | null
  segment_definition?: unknown
  scheduled_at?: string | null
  sent_at?: string | null
  updated_at?: string | null
}

export interface CampaignView {
  id: number
  name: string
  channelLabel: string
  status: string
  statusLabel: string
  /** The subject for email, the opening of the message for SMS. */
  summary: string
  audienceLabel: string
  whenLabel: string
  canSend: boolean
  canPause: boolean
  canCancel: boolean
}

const SUMMARY_MAX = 120

function summaryOf(row: CampaignRow): string {
  const source = row.type === 'sms' ? (row.text || '') : (row.subject || '')
  const text = source.replace(/\s+/g, ' ').trim()
  if (!text)
    return row.type === 'sms' ? 'No message yet' : 'No subject yet'
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 3).trimEnd()}...` : text
}

function whenLabelOf(row: CampaignRow, locale?: string): string {
  if (row.sent_at)
    return `Sent ${formatSeen(row.sent_at, locale)}`
  if (row.scheduled_at)
    return `Scheduled for ${formatSeen(row.scheduled_at, locale)}`
  return `Last changed ${formatSeen(row.updated_at, locale)}`
}

/** Normalize one API row into the shape the list renders. */
export function toCampaignView(row: CampaignRow, audiences: AudienceOption[] = [], locale?: string): CampaignView {
  const status = String(row.status || 'draft')
  const audienceId = audienceIdOf(row.segment_definition)
  const audience = audienceId ? audiences.find(item => item.id === audienceId) : undefined

  return {
    id: row.id,
    name: (row.name || '').trim() || `Campaign ${row.id}`,
    channelLabel: channelLabel(row.type),
    status,
    statusLabel: statusLabel(status),
    summary: summaryOf(row),
    // An id with no matching name is an audience that was deleted, or one
    // past the picker's first page. Named by its id rather than guessed at.
    audienceLabel: audienceId ? (audience ? audience.name : `Audience ${audienceId}`) : EVERY_CONTACT_LABEL,
    whenLabel: whenLabelOf(row, locale),
    canSend: (DISPATCHABLE_STATUSES as readonly string[]).includes(status),
    canPause: (PAUSABLE_STATUSES as readonly string[]).includes(status),
    canCancel: (CANCELLABLE_STATUSES as readonly string[]).includes(status),
  }
}

export function toCampaignViews(body: { data?: CampaignRow[] } | null | undefined, audiences: AudienceOption[] = [], locale?: string): CampaignView[] {
  return (body?.data ?? []).map(row => toCampaignView(row, audiences, locale))
}

/** What the create form holds. `audienceId` is '' for every active contact. */
export interface CampaignDraft {
  name?: string
  channel?: string
  subject?: string
  text?: string
  audienceId?: string | number
}

/** Why a draft cannot be saved, against the limits the model declares. */
export function draftError(draft: CampaignDraft): string {
  const name = (draft.name ?? '').trim()
  const subject = (draft.subject ?? '').trim()
  const text = (draft.text ?? '').trim()
  if (name.length < CAMPAIGN_NAME_MIN)
    return `A campaign name needs at least ${CAMPAIGN_NAME_MIN} characters.`
  if (name.length > CAMPAIGN_NAME_MAX)
    return `A campaign name can be at most ${CAMPAIGN_NAME_MAX} characters.`
  if (draft.channel !== 'sms' && !subject)
    return 'An email campaign needs a subject line.'
  if (subject.length > CAMPAIGN_SUBJECT_MAX)
    return `A subject line can be at most ${CAMPAIGN_SUBJECT_MAX} characters.`
  if (!text)
    return 'A campaign needs a message to send.'
  return ''
}

export interface CampaignPayload {
  name: string
  type: 'email' | 'sms'
  status: 'draft'
  subject?: string
  text: string
  segment_definition?: string
}

/**
 * The request body for a new campaign.
 *
 * Always a draft: creating a campaign never sends it, and sending is its own
 * confirmed step on the list. An SMS carries no subject. With no audience the
 * `segment_definition` is left out, which the dispatch action reads as every
 * active contact, so the page says exactly that where the audience would be.
 */
export function campaignPayload(draft: CampaignDraft): CampaignPayload {
  const type = draft.channel === 'sms' ? 'sms' : 'email'
  const payload: CampaignPayload = {
    name: (draft.name ?? '').trim(),
    type,
    status: 'draft',
    text: (draft.text ?? '').trim(),
  }
  if (type === 'email')
    payload.subject = (draft.subject ?? '').trim()
  const audienceId = Number(draft.audienceId)
  if (Number.isInteger(audienceId) && audienceId > 0)
    payload.segment_definition = JSON.stringify({ audienceId })
  return payload
}

/** What the dispatch action answered with, in words. */
export function dispatchResultMessage(body: { queued?: number | null, status?: string | null } | null | undefined): string {
  const queued = Math.max(0, Number(body?.queued) || 0)
  if (queued === 0)
    return 'Nothing was queued: no active contact in that audience has an address for this channel, or all of them were queued before.'
  return `Queued for ${queued} ${queued === 1 ? 'recipient' : 'recipients'}. Each one is checked for consent before it is sent.`
}

/** What to tell someone when the listing failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your campaigns.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no campaigns to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Campaigns could not be loaded because the API is not answering.'
  return `Campaigns could not be loaded (${status}).`
}

/** What to tell someone when a save or a status change failed. */
export function saveErrorMessage(status: number): string {
  if (status === 422)
    return 'That campaign was rejected as invalid. Check the name, the subject and the message.'
  if (status === 404)
    return 'That campaign no longer exists. The list has been refreshed.'
  if (status === 401)
    return 'Your session has ended. Sign in again to save this campaign.'
  if (status === 403)
    return 'That request was refused. Reload the page and try again.'
  return `The campaign could not be saved (${status}).`
}

/** What to tell someone when a send was refused. 409 is a status it cannot send from. */
export function dispatchErrorMessage(status: number): string {
  if (status === 409)
    return 'That campaign can no longer be sent from its current status. The list has been refreshed.'
  if (status === 404)
    return 'That campaign no longer exists. The list has been refreshed.'
  if (status === 429)
    return 'Too many sends just now. Wait a minute and try again.'
  if (status === 401)
    return 'Your session has ended. Sign in again to send this campaign.'
  if (status === 403)
    return 'That request was refused. Reload the page and try again.'
  return `The campaign could not be sent (${status}).`
}
