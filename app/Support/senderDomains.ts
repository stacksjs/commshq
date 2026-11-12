import { randomBytes } from 'node:crypto'

/**
 * Sending domains: what a team must prove before it may send as an address.
 *
 * `DispatchCampaign` refuses an email whose From domain is not a `verified`
 * row in `sender_domains` for the team. Nothing could ever make a row
 * verified: there was no endpoint to add a domain and no check to pass, so
 * every email campaign failed at that line.
 *
 * The check is ownership. A team adds a domain, is given a TXT record to
 * publish under it, and the domain becomes verified once that record is seen
 * in DNS. Only someone who controls the domain's DNS can publish it, which is
 * the thing being proven: that this team may put the domain in a From line.
 *
 * It is deliberately not the generated CRUD. `SenderDomain` declares `status`
 * fillable, so its generated API would accept `{ "status": "verified" }` from
 * any member and the proof would be a field in a request body.
 *
 * What this does not check is deliverability. SPF, DKIM and DMARC decide
 * whether a receiving server trusts the mail, and they depend on the mail
 * server in use; the record here only settles who may send as the domain.
 */

export const VERIFICATION_LABEL = '_commshq-verify'
export const VERIFICATION_PREFIX = 'commshq-verify='
export const DOMAIN_MAX = 253

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TOP_LEVEL = /^[a-z][a-z0-9-]*[a-z0-9]$/

/**
 * A domain in the one form it is stored and compared in: lowercase, no
 * trailing dot, no surrounding space. Returns undefined for anything that is
 * not a plain hostname with at least two labels, which rules out addresses,
 * URLs, IP literals and single-label names.
 */
export function normalizeDomain(value: unknown): string | undefined {
  const domain = String(value ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!domain || domain.length > DOMAIN_MAX)
    return undefined
  const labels = domain.split('.')
  if (labels.length < 2 || !labels.every(label => LABEL.test(label)))
    return undefined
  // A numeric last label is an IP literal, not a domain.
  if (!TOP_LEVEL.test(labels[labels.length - 1] ?? ''))
    return undefined
  return domain
}

/** The domain an address sends from, or undefined when it is not an address. */
export function domainOfAddress(address: unknown): string | undefined {
  const text = String(address ?? '').trim()
  const at = text.lastIndexOf('@')
  if (at < 1 || text.slice(0, at).includes(' '))
    return undefined
  return normalizeDomain(text.slice(at + 1))
}

export function newVerificationToken(): string {
  return randomBytes(16).toString('hex')
}

export interface VerificationRecord {
  type: 'TXT'
  host: string
  value: string
}

/** The record a team publishes to prove it controls `domain`. */
export function verificationRecord(domain: string, token: string): VerificationRecord {
  return { type: 'TXT', host: `${VERIFICATION_LABEL}.${domain}`, value: `${VERIFICATION_PREFIX}${token}` }
}

/**
 * The verification record stored on a domain row, read back out of its
 * `dns_records` column. Undefined when the column holds anything else, so a
 * row written some other way cannot be verified against a record it never
 * had.
 */
export function storedVerification(dnsRecords: unknown): VerificationRecord | undefined {
  let records: unknown = dnsRecords
  if (typeof records === 'string') {
    try {
      records = JSON.parse(records)
    }
    catch {
      return undefined
    }
  }
  if (!Array.isArray(records))
    return undefined
  const found = records.find((record: any) => {
    return record && record.type === 'TXT'
      && typeof record.host === 'string' && record.host.startsWith(`${VERIFICATION_LABEL}.`)
      && typeof record.value === 'string' && record.value.startsWith(VERIFICATION_PREFIX)
      && record.value.length > VERIFICATION_PREFIX.length
  }) as VerificationRecord | undefined
  return found ? { type: 'TXT', host: found.host, value: found.value } : undefined
}

/**
 * Whether a TXT lookup's answer carries the expected value.
 *
 * `resolveTxt` returns each record as its chunks, since one TXT record may
 * be split into several strings; they are joined before comparing. The match
 * is exact after trimming: a value that merely contains the token is not it.
 */
export function txtAnswerMatches(answer: unknown, expected: string): boolean {
  if (!Array.isArray(answer) || !expected)
    return false
  return answer.some((record) => {
    const joined = Array.isArray(record) ? record.join('') : String(record ?? '')
    return joined.trim() === expected
  })
}

/** Adding, checking and removing a sending domain or a sender is an admin's job. */
export function canManageSending(role: unknown): boolean {
  return ['owner', 'admin'].includes(String(role || '').toLowerCase())
}
