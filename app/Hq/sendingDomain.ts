import { dkimRecordKey } from '@stacksjs/email'
import { storedVerification, txtAnswerMatches, VERIFICATION_LABEL, verificationRecord } from '../Support/senderDomains'

/**
 * The sending domain of a connected app: the records that let its mail come
 * from its own address, and the check that they are there.
 *
 * Two things have to be true before CommsHQ puts a domain in a From line for
 * an app. The app's owner controls the domain: the ownership record every
 * sending domain here already needs (app/Support/senderDomains.ts). And the
 * domain publishes the key CommsHQ signs its mail with, so a receiver can
 * check the signature against the domain itself.
 *
 * That second record is what makes the mail authentic. CommsHQ sends through
 * its own mail server with its own envelope sender, so SPF passes for
 * CommsHQ's domain and says nothing about the app's. The signature is made
 * with the app domain's key, its `d=` is the From domain, and DMARC passes on
 * it. The app's own SPF record is neither needed nor touched.
 *
 * A DMARC record is offered too, as `p=none`: it asks receivers to report and
 * rejects nothing, and it is only ever created where the domain has none.
 */

/** The selector CommsHQ's key is published under: `commshq._domainkey.<domain>`. */
export const DKIM_SELECTOR = 'commshq'

export type RecordPurpose = 'ownership' | 'dkim' | 'dmarc'

export interface StoredDomainRecord {
  type: 'TXT'
  host: string
  value: string
  purpose?: RecordPurpose
}

/** A record as the API answers it. */
export interface DomainRecord {
  type: 'TXT'
  name: string
  content: string
  purpose: RecordPurpose
}

export function dkimHost(domain: string): string {
  return `${DKIM_SELECTOR}._domainkey.${domain}`
}

export function dmarcHost(domain: string): string {
  return `_dmarc.${domain}`
}

/** The records a domain is given: proof of control, the signing key, and a DMARC policy that only reports. */
export function sendingDomainRecords(domain: string, token: string, dkimRecord: string): StoredDomainRecord[] {
  const ownership = verificationRecord(domain, token)
  return [
    { ...ownership, purpose: 'ownership' },
    { type: 'TXT', host: dkimHost(domain), value: dkimRecord, purpose: 'dkim' },
    { type: 'TXT', host: dmarcHost(domain), value: 'v=DMARC1; p=none', purpose: 'dmarc' },
  ]
}

function parse(dnsRecords: unknown): any[] {
  let records: unknown = dnsRecords
  if (typeof records === 'string') {
    try {
      records = JSON.parse(records)
    }
    catch {
      return []
    }
  }
  return Array.isArray(records) ? records : []
}

/** The stored records in the form the API answers them. */
export function recordsForApi(dnsRecords: unknown): DomainRecord[] {
  const out: DomainRecord[] = []
  for (const record of parse(dnsRecords)) {
    if (!record || record.type !== 'TXT' || typeof record.host !== 'string' || typeof record.value !== 'string')
      continue
    const purpose: RecordPurpose = record.purpose === 'dkim' || record.purpose === 'dmarc'
      ? record.purpose
      : record.host.startsWith(`${VERIFICATION_LABEL}.`) ? 'ownership' : 'dkim'
    out.push({ type: 'TXT', name: record.host, content: record.value, purpose })
  }
  return out
}

/** The stored DKIM record, where the row has one. */
export function storedDkim(dnsRecords: unknown): StoredDomainRecord | undefined {
  return parse(dnsRecords).find(record => record?.purpose === 'dkim' && typeof record.host === 'string' && typeof record.value === 'string')
}

/** Look a TXT name up. A name with no record is an empty answer, not a failure. */
export type TxtLookup = (host: string) => Promise<{ answer: string[][], failed: boolean }>

export interface DomainChecks {
  ownership: boolean
  dkim: boolean
  /** True when DNS itself could not be asked: nothing was learned. */
  unreachable: boolean
}

/**
 * Whether a TXT answer publishes this key. Compared on the key alone: DNS
 * splits a long record into strings, and a provider may reorder its tags.
 */
export function dkimAnswerMatches(answer: unknown, expectedRecord: string): boolean {
  const expected = dkimRecordKey(expectedRecord)
  if (!Array.isArray(answer) || !expected)
    return false
  const strings = (record: unknown): string => (Array.isArray(record) ? record.join('') : String(record ?? ''))
  if (answer.some(record => dkimRecordKey(strings(record)) === expected))
    return true
  // A key longer than 255 characters is one record in several strings. Node
  // answers it as one entry holding them all, and Bun as an entry for each,
  // as though they were separate records. Put back together in the order
  // they came, they are the record that was published.
  return dkimRecordKey(answer.map(strings).join('')) === expected
}

/**
 * Look for a domain's ownership and DKIM records in DNS.
 *
 * What is expected is read from the stored row, never from a request, so the
 * only way to pass is to publish the records this application issued.
 */
export async function checkSendingDomain(dnsRecords: unknown, lookup: TxtLookup): Promise<DomainChecks> {
  const ownership = storedVerification(dnsRecords)
  const dkim = storedDkim(dnsRecords)
  const checks: DomainChecks = { ownership: false, dkim: false, unreachable: false }

  if (ownership) {
    const found = await lookup(ownership.host)
    checks.unreachable ||= found.failed
    checks.ownership = txtAnswerMatches(found.answer, ownership.value)
  }
  if (dkim) {
    const found = await lookup(dkim.host)
    checks.unreachable ||= found.failed
    checks.dkim = dkimAnswerMatches(found.answer, dkim.value)
  }
  return checks
}
