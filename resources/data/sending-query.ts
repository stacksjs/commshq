/**
 * Sending domains and senders, through the application's own API.
 *
 * Both pages were areas of `WorkspaceSurface`: four verified domains with
 * "12/12" DNS checks and TLS status, six verified senders with a 0.24%
 * bounce rate and a 0.018% complaint rate. Nothing recorded any of it, and
 * nothing could: there was no endpoint to add a domain and no check that
 * could ever verify one, so every email campaign failed at the line in
 * `DispatchCampaign` that requires a verified sending domain.
 *
 * The routes behind these pages are in `routes/api.ts` under
 * `Actions/Api/V1/Sending`. A domain is added as pending and given one TXT
 * record to publish; checking it looks that record up in DNS. A sender is an
 * email address, verified exactly when its domain is.
 *
 * ## What the pages do not show
 *
 * No SPF, DKIM or DMARC results, no TLS and no web domains. The check here
 * proves who may send as a domain. Whether receiving servers trust the mail
 * depends on the mail server's own records, which this application does not
 * read. No bounce or complaint rates either: nothing aggregates them.
 */
import { formatSeen } from './contacts-query'

export const DOMAINS_ENDPOINT = '/api/v1/sender-domains'
export const SENDERS_ENDPOINT = '/api/v1/sender-identities'
export const SENDERS_PER_PAGE = 50

export const SENDER_NAME_MAX = 160
export const ADDRESS_MAX = 255
export const DOMAIN_MAX = 253

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TOP_LEVEL = /^[a-z][a-z0-9-]*[a-z0-9]$/

/**
 * The same reading of a domain the server does in
 * `app/Support/senderDomains.ts`, so the form refuses what the endpoint
 * would. A test holds the two together.
 */
export function normalizeDomain(value: unknown): string | undefined {
  const domain = String(value ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!domain || domain.length > DOMAIN_MAX)
    return undefined
  const labels = domain.split('.')
  if (labels.length < 2 || !labels.every(label => LABEL.test(label)))
    return undefined
  if (!TOP_LEVEL.test(labels[labels.length - 1] ?? ''))
    return undefined
  return domain
}

export function domainOfAddress(address: unknown): string | undefined {
  const text = String(address ?? '').trim()
  const at = text.lastIndexOf('@')
  if (at < 1 || text.slice(0, at).includes(' '))
    return undefined
  return normalizeDomain(text.slice(at + 1))
}

export function domainUrl(id: number): string {
  return `${DOMAINS_ENDPOINT}/${Math.trunc(Number(id))}`
}

export function verifyUrl(id: number): string {
  return `${domainUrl(id)}/verify`
}

export function sendersUrl(): string {
  const params = new URLSearchParams()
  params.set('per_page', String(SENDERS_PER_PAGE))
  params.set('channel', 'email')
  params.set('sort', 'name,id')
  return `${SENDERS_ENDPOINT}?${params.toString()}`
}

export function senderUrl(id: number): string {
  return `${SENDERS_ENDPOINT}/${Math.trunc(Number(id))}`
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for DNS',
  verified: 'Verified',
  failed: 'Failed',
  disabled: 'Disabled',
}

export function domainStatusLabel(status?: string | null): string {
  return STATUS_LABELS[String(status || '')] ?? 'Unknown'
}

export interface DomainRow {
  id: number
  domain?: string | null
  status?: string | null
  dns_records?: unknown
  verified_at?: string | null
  last_checked_at?: string | null
}

export interface DomainView {
  id: number
  domain: string
  status: string
  statusLabel: string
  verified: boolean
  /** The TXT record to publish, empty once verified or when the row has none. */
  recordHost: string
  recordValue: string
  checkedLabel: string
}

function firstTxtRecord(dnsRecords: unknown): { host: string, value: string } {
  let records: unknown = dnsRecords
  if (typeof records === 'string') {
    try {
      records = JSON.parse(records)
    }
    catch {
      records = null
    }
  }
  const found = Array.isArray(records)
    ? records.find((record: any) => record && record.type === 'TXT' && typeof record.host === 'string' && typeof record.value === 'string')
    : undefined
  return found ? { host: String(found.host), value: String(found.value) } : { host: '', value: '' }
}

/** Normalize one domain row into the shape the list renders. */
export function toDomainView(row: DomainRow, locale?: string): DomainView {
  const status = String(row.status || 'pending')
  const verified = status === 'verified'
  const record = firstTxtRecord(row.dns_records)

  let checkedLabel = 'Not checked yet'
  if (verified)
    checkedLabel = `Verified ${formatSeen(row.verified_at, locale)}`
  else if (row.last_checked_at)
    checkedLabel = `Last checked ${formatSeen(row.last_checked_at, locale)}, record not found`

  return {
    id: row.id,
    domain: (row.domain || '').trim() || `Domain ${row.id}`,
    status,
    statusLabel: domainStatusLabel(status),
    verified,
    // A verified domain no longer needs the record on screen.
    recordHost: verified ? '' : record.host,
    recordValue: verified ? '' : record.value,
    checkedLabel,
  }
}

export function toDomainViews(body: { data?: DomainRow[] } | null | undefined, locale?: string): DomainView[] {
  return (body?.data ?? []).map(row => toDomainView(row, locale))
}

/** Why a domain cannot be added. */
export function domainDraftError(value?: string): string {
  const text = String(value ?? '').trim()
  if (!text)
    return 'Enter the domain you send from, such as mail.example.com.'
  if (text.includes('@'))
    return 'Enter the domain only, without an address in front of it.'
  if (!normalizeDomain(text))
    return 'That is not a domain. Use a hostname such as mail.example.com, without http or a path.'
  return ''
}

export function domainPayload(value?: string): { domain: string } {
  return { domain: normalizeDomain(value) ?? '' }
}

/** What a DNS check answered with, in words. */
export function verifyResultMessage(body: { data?: { verified?: boolean } } | null | undefined, domain: string): string {
  if (body?.data?.verified === true)
    return `${domain} is verified. Senders at this domain can now be used.`
  return `The record for ${domain} was not found yet. DNS changes can take up to an hour to appear, so check again later.`
}

export interface SenderRow {
  id: number
  name?: string | null
  address?: string | null
  reply_to?: string | null
  status?: string | null
}

export interface SenderView {
  id: number
  name: string
  address: string
  replyLabel: string
  status: string
  verified: boolean
  /** One sentence on where this sender stands and what would change it. */
  standing: string
}

/**
 * Normalize one sender row.
 *
 * `verifiedDomains` is the team's verified domains, lowercased. The standing
 * line uses it to tell the two kinds of pending apart: a domain that is
 * waiting on DNS, and a domain nobody has added.
 */
export function toSenderView(row: SenderRow, knownDomains: { domain: string, verified: boolean }[] = []): SenderView {
  const status = String(row.status || 'pending')
  const address = (row.address || '').trim()
  const domain = domainOfAddress(address)
  const known = domain ? knownDomains.find(item => item.domain === domain) : undefined
  const verified = status === 'verified'

  let standing = 'This sender is not available.'
  if (verified)
    standing = 'Verified. Messages can be sent from this address.'
  else if (status === 'pending' && !domain)
    standing = 'Not verified. This is not an address at a domain.'
  else if (status === 'pending' && !known)
    standing = `Not verified. Add ${domain} as a sending domain to use this address.`
  else if (status === 'pending')
    standing = `Not verified. ${domain} is still waiting for its DNS record.`

  return {
    id: row.id,
    name: (row.name || '').trim() || address || `Sender ${row.id}`,
    address,
    replyLabel: row.reply_to ? `Replies go to ${row.reply_to}` : 'Replies go to the same address',
    status,
    verified,
    standing,
  }
}

export function toSenderViews(body: { data?: SenderRow[] } | null | undefined, knownDomains: { domain: string, verified: boolean }[] = []): SenderView[] {
  return (body?.data ?? []).map(row => toSenderView(row, knownDomains))
}

export interface SenderDraft {
  name?: string
  address?: string
  replyTo?: string
}

/** Why a sender cannot be added. */
export function senderDraftError(draft: SenderDraft): string {
  const name = (draft.name ?? '').trim()
  const address = (draft.address ?? '').trim()
  const replyTo = (draft.replyTo ?? '').trim()
  if (!name)
    return 'A sender needs a name, the one people see in their inbox.'
  if (name.length > SENDER_NAME_MAX)
    return `A sender name can be at most ${SENDER_NAME_MAX} characters.`
  if (!domainOfAddress(address) || address.length > ADDRESS_MAX)
    return 'A sender needs an email address, such as hello@example.com.'
  if (replyTo && (!domainOfAddress(replyTo) || replyTo.length > ADDRESS_MAX))
    return 'The reply address is not an email address.'
  return ''
}

export function senderPayload(draft: SenderDraft): { name: string, address: string, replyTo?: string } {
  const payload: { name: string, address: string, replyTo?: string } = {
    name: (draft.name ?? '').trim(),
    address: (draft.address ?? '').trim().toLowerCase(),
  }
  const replyTo = (draft.replyTo ?? '').trim().toLowerCase()
  if (replyTo)
    payload.replyTo = replyTo
  return payload
}

/** What to tell someone when a list failed. `what` is "sending domains" or "senders". */
export function listErrorMessage(status: number, what: string): string {
  const title = what.charAt(0).toUpperCase() + what.slice(1)
  if (status === 401)
    return `Your session has ended. Sign in again to see your ${what}.`
  if (status === 403)
    return `This account is not an active member of a workspace, so it has no ${what} to show.`
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return `${title} could not be loaded because the API is not answering.`
  return `${title} could not be loaded (${status}).`
}

/** What to tell someone when a change to a domain was refused. */
export function domainErrorMessage(status: number): string {
  if (status === 409)
    return 'That domain is already registered, here or in another workspace.'
  if (status === 422)
    return 'That domain was rejected as invalid. Use a hostname such as mail.example.com.'
  if (status === 404)
    return 'That domain no longer exists. The list has been refreshed.'
  if (status === 403)
    return 'Only a workspace owner or admin can change sending domains.'
  if (status === 401)
    return 'Your session has ended. Sign in again to continue.'
  if (status === 429)
    return 'Too many attempts just now. Wait a minute and try again.'
  if (status === 503)
    return 'DNS could not be reached to check this domain. Try again shortly.'
  return `That change could not be made (${status}).`
}

/** What to tell someone when a change to a sender was refused. */
export function senderErrorMessage(status: number): string {
  if (status === 409)
    return 'This workspace already has a sender at that address.'
  if (status === 422)
    return 'That sender was rejected as invalid. Check the name and the address.'
  if (status === 404)
    return 'That sender no longer exists. The list has been refreshed.'
  if (status === 403)
    return 'Only a workspace owner or admin can change senders.'
  if (status === 401)
    return 'Your session has ended. Sign in again to continue.'
  if (status === 429)
    return 'Too many attempts just now. Wait a minute and try again.'
  return `That change could not be made (${status}).`
}
