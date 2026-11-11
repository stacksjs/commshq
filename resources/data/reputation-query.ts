/**
 * Reading and acting on reputation data through the application's own API.
 *
 * The backend here was already complete: connectors for Google Business and
 * Yelp, jobs that poll profiles and evaluate alert rules, and four write
 * actions in `routes/api.ts`. The page in front of it was the `reputation`
 * area of `WorkspaceSurface`, a set of literals. This module is the requests
 * the real page makes:
 *
 *   GET  /api/v1/monitored-profiles            list (useApi, read-only)
 *   POST /api/v1/monitored-profiles            CreateMonitoredProfileAction
 *   GET  /api/v1/reputation-mentions           list (useApi, read-only)
 *   POST /api/v1/reputation-mentions/{id}/triage    TriageMentionAction
 *   GET  /api/v1/reputation-alerts             list (useApi, read-only)
 *   POST /api/v1/reputation-alerts/{id}/decision    AcknowledgeAlertAction
 *
 * Every route sits behind `auth` and `team`. The write actions also check the
 * member's role, so a 403 on a write is a role answer and is worded as one.
 */
import { formatSeen } from './contacts-query'
import { formatCount } from './workspace-summary'

export const PROFILES_ENDPOINT = '/api/v1/monitored-profiles'
export const MENTIONS_ENDPOINT = '/api/v1/reputation-mentions'
export const ALERTS_ENDPOINT = '/api/v1/reputation-alerts'

export const MENTIONS_PER_PAGE = 25

/**
 * The platforms a profile can be added for.
 *
 * Two, not the ten the model's enum lists. `CreateMonitoredProfileAction`
 * refuses a platform with no connector, and `reputationProviders.ts` registers
 * exactly these. Offering the other eight would be a form whose most likely
 * outcome is a 422.
 */
export const CONNECTOR_PLATFORMS = [
  { value: 'google_business', label: 'Google Business' },
  { value: 'yelp', label: 'Yelp' },
] as const

const PLATFORM_LABELS: Record<string, string> = {
  google_business: 'Google Business',
  yelp: 'Yelp',
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  trustpilot: 'Trustpilot',
  reddit: 'Reddit',
}

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** The words for a platform, falling back to the raw value rather than hiding it. */
export function platformLabel(platform?: string | null): string {
  const raw = String(platform ?? '').trim()
  return PLATFORM_LABELS[raw] || (raw ? titleCase(raw) : 'Unknown')
}

/** The sentiments a mention can carry, as the model's enum declares them. */
export const MENTION_SENTIMENTS = [
  { value: 'negative', label: 'Negative' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'positive', label: 'Positive' },
  { value: 'unknown', label: 'Not scored' },
] as const

export function sentimentLabel(sentiment?: string | null): string {
  const known = MENTION_SENTIMENTS.find(item => item.value === sentiment)
  return known ? known.label : (sentiment ? titleCase(String(sentiment)) : 'Not scored')
}

const PROFILE_STATUS_LABELS: Record<string, string> = {
  active: 'Monitoring',
  paused: 'Paused',
  // The action's own comment: the first sync decides whether the credential
  // works, and until then the profile is reported as not yet configured.
  unconfigured: 'Waiting for first sync',
  error: 'Failing',
}

export function profileStatusLabel(status?: string | null): string {
  const raw = String(status ?? '')
  return PROFILE_STATUS_LABELS[raw] || (raw ? titleCase(raw) : 'Unknown')
}

const METRIC_LABELS: Record<string, string> = {
  negative_mention_count: 'Negative mentions',
  mention_volume: 'Mention volume',
  average_rating: 'Average rating',
  average_sentiment: 'Average sentiment',
  unanswered_negative_count: 'Unanswered negative mentions',
}

export function metricLabel(metric?: string | null): string {
  const raw = String(metric ?? '')
  return METRIC_LABELS[raw] || (raw ? titleCase(raw) : 'Unknown metric')
}

/** Profiles by name. A workspace monitors a handful, so one page holds them. */
export function profilesUrl(): string {
  const params = new URLSearchParams()
  params.set('per_page', '100')
  params.set('sort', 'display_name')
  return `${PROFILES_ENDPOINT}?${params.toString()}`
}

/**
 * Mentions, newest first.
 *
 * `-id` breaks ties: a single sync writes many mentions, and reviews imported
 * together can share a posted time, which is the tie that let a row appear on
 * two pages of the contacts list. Sentiment is an equality filter because it
 * is a column; an empty one is left out rather than sent blank.
 */
export function mentionsUrl(query: { page?: number, perPage?: number, sentiment?: string } = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? MENTIONS_PER_PAGE))))
  if (query.sentiment)
    params.set('sentiment', query.sentiment)
  params.set('sort', '-posted_at,-id')
  return `${MENTIONS_ENDPOINT}?${params.toString()}`
}

/** Alerts, newest first. Resolved ones stay listed, as the record of what fired. */
export function alertsUrl(): string {
  const params = new URLSearchParams()
  params.set('per_page', '25')
  params.set('sort', '-created_at,-id')
  return `${ALERTS_ENDPOINT}?${params.toString()}`
}

export function triageUrl(id: number): string {
  return `${MENTIONS_ENDPOINT}/${Math.trunc(Number(id))}/triage`
}

export function decisionUrl(id: number): string {
  return `${ALERTS_ENDPOINT}/${Math.trunc(Number(id))}/decision`
}

export interface ProfileRow {
  id: number
  platform?: string | null
  display_name?: string | null
  handle?: string | null
  location_label?: string | null
  status?: string | null
  last_polled_at?: string | null
  last_error?: string | null
}

export interface ProfileView {
  id: number
  name: string
  platformLabel: string
  /** Where it is or what it is called there, when the row says. */
  detail: string
  statusLabel: string
  lastPolledLabel: string
  /** The connector's last error, shown only while the profile is failing. */
  error: string
}

export function toProfileView(row: ProfileRow, locale?: string): ProfileView {
  return {
    id: row.id,
    name: (row.display_name || '').trim() || `Profile ${row.id}`,
    platformLabel: platformLabel(row.platform),
    detail: (row.location_label || row.handle || '').trim(),
    statusLabel: profileStatusLabel(row.status),
    lastPolledLabel: formatSeen(row.last_polled_at, locale),
    error: row.status === 'error' ? (row.last_error || '').trim() : '',
  }
}

export function toProfileViews(body: { data?: ProfileRow[] } | null | undefined, locale?: string): ProfileView[] {
  return (body?.data ?? []).map(row => toProfileView(row, locale))
}

export interface MentionRow {
  id: number
  platform?: string | null
  kind?: string | null
  author_name?: string | null
  author_handle?: string | null
  body?: string | null
  rating?: number | null
  sentiment?: string | null
  status?: string | null
  posted_at?: string | null
}

export interface MentionView {
  id: number
  author: string
  platformLabel: string
  kindLabel: string
  body: string
  /** "2 of 5", or empty for a mention that carries no rating. */
  ratingLabel: string
  sentimentLabel: string
  status: string
  statusLabel: string
  postedLabel: string
}

const MENTION_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  triaged: 'Triaged',
  responded: 'Responded',
  ignored: 'Ignored',
}

/**
 * Normalize one mention.
 *
 * `raw`, the provider's original payload, is never copied into the view, and
 * neither is the sentiment score: the page shows the classification the
 * pipeline settled on, not a number that invites reading 12 as worse than 9.
 */
export function toMentionView(row: MentionRow, locale?: string): MentionView {
  const rating = Number(row.rating)
  const status = String(row.status || 'new')
  return {
    id: row.id,
    author: (row.author_name || row.author_handle || '').trim() || 'Unknown author',
    platformLabel: platformLabel(row.platform),
    kindLabel: titleCase(String(row.kind || 'mention')),
    body: (row.body || '').trim(),
    ratingLabel: Number.isFinite(rating) && rating >= 1 ? `${formatCount(rating, locale)} of 5` : '',
    sentimentLabel: sentimentLabel(row.sentiment),
    status,
    statusLabel: MENTION_STATUS_LABELS[status] || titleCase(status),
    postedLabel: formatSeen(row.posted_at, locale),
  }
}

export function toMentionViews(body: { data?: MentionRow[] } | null | undefined, locale?: string): MentionView[] {
  return (body?.data ?? []).map(row => toMentionView(row, locale))
}

export interface AlertRow {
  id: number
  metric?: string | null
  severity?: string | null
  observed_value?: number | string | null
  threshold_value?: number | string | null
  sample_size?: number | null
  status?: string | null
  created_at?: string | null
}

export interface AlertView {
  id: number
  title: string
  detail: string
  severityLabel: string
  status: string
  statusLabel: string
  raisedLabel: string
}

/** A decimal as written, without trailing zeros: 4.20 reads 4.2 and 3.00 reads 3. */
function plainNumber(value: unknown): string {
  const number = Number(value)
  return Number.isFinite(number) ? String(Number(number.toFixed(2))) : '0'
}

export function toAlertView(row: AlertRow, locale?: string): AlertView {
  const status = String(row.status || 'open')
  const sample = Math.max(0, Math.trunc(Number(row.sample_size) || 0))
  return {
    id: row.id,
    title: metricLabel(row.metric),
    detail: `Observed ${plainNumber(row.observed_value)} against a threshold of ${plainNumber(row.threshold_value)}, across ${formatCount(sample, locale)} ${sample === 1 ? 'mention' : 'mentions'}.`,
    severityLabel: titleCase(String(row.severity || 'warning')),
    status,
    statusLabel: titleCase(status),
    raisedLabel: formatSeen(row.created_at, locale),
  }
}

export function toAlertViews(body: { data?: AlertRow[] } | null | undefined, locale?: string): AlertView[] {
  return (body?.data ?? []).map(row => toAlertView(row, locale))
}

/** What the add-profile form holds. */
export interface ProfileDraft {
  platform?: string
  displayName?: string
  externalId?: string
}

/** Why a draft cannot be saved, against the limits the action enforces. */
export function profileDraftError(draft: ProfileDraft): string {
  const name = (draft.displayName ?? '').trim()
  const externalId = (draft.externalId ?? '').trim()
  if (!name)
    return 'A profile needs a name.'
  if (name.length > 160)
    return 'A profile name can be at most 160 characters.'
  if (!externalId)
    return 'A profile needs the identifier the platform knows it by.'
  if (externalId.length > 255)
    return 'A platform identifier can be at most 255 characters.'
  return ''
}

/**
 * The request body for a new profile.
 *
 * camelCase, unlike the generated endpoints: this goes to a hand-written
 * action that reads `externalId` and `displayName` by those names. A platform
 * without a connector falls back to the first that has one.
 */
export function profilePayload(draft: ProfileDraft): { platform: string, displayName: string, externalId: string } {
  const platform = CONNECTOR_PLATFORMS.some(item => item.value === draft.platform) ? String(draft.platform) : CONNECTOR_PLATFORMS[0].value
  return {
    platform,
    displayName: (draft.displayName ?? '').trim(),
    externalId: (draft.externalId ?? '').trim(),
  }
}

/** What to tell someone when a listing failed. */
export function listErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see reputation monitoring.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so it has no monitoring to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Reputation monitoring could not be loaded because the API is not answering.'
  return `Reputation monitoring could not be loaded (${status}).`
}

/** What to tell someone when adding a profile failed. */
export function profileSaveErrorMessage(status: number): string {
  if (status === 409)
    return 'This profile is already monitored in this workspace.'
  if (status === 403)
    return 'Adding a profile needs an admin or owner role in this workspace.'
  if (status === 422)
    return 'That profile was rejected. Check the platform and its identifier.'
  if (status === 429)
    return 'Too many profiles added just now. Wait a moment and try again.'
  if (status === 401)
    return 'Your session has ended. Sign in again to add this profile.'
  return `The profile could not be added (${status}).`
}

/** What to tell someone when a triage or an alert decision failed. */
export function actionErrorMessage(status: number): string {
  if (status === 409)
    return 'That was already done, probably by someone else. The list has been refreshed.'
  if (status === 404)
    return 'That item no longer exists. The list has been refreshed.'
  if (status === 403)
    return 'Your role in this workspace does not allow that.'
  if (status === 429)
    return 'Too many actions just now. Wait a moment and try again.'
  if (status === 401)
    return 'Your session has ended. Sign in again to continue.'
  return `That could not be saved (${status}).`
}
