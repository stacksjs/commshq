/**
 * Sending domains: the ownership check, and the pages over it.
 *
 * The rule everything else rests on is that no request body can make a
 * domain or a sender verified. A domain passes only when the record this
 * application issued is found in DNS, and a sender is verified only through
 * its domain. The tests hold that rule to the routes and the model as well as
 * to the functions, because the hole it closes was in the generated API.
 */
import { describe, expect, test } from 'bun:test'
import {
  canManageSending,
  domainOfAddress as serverDomainOfAddress,
  newVerificationToken,
  normalizeDomain as serverNormalizeDomain,
  storedVerification,
  txtAnswerMatches,
  VERIFICATION_PREFIX,
  verificationRecord,
} from '../../app/Support/senderDomains'
import {
  domainDraftError,
  domainErrorMessage,
  domainOfAddress,
  domainPayload,
  DOMAINS_ENDPOINT,
  domainStatusLabel,
  domainUrl,
  listErrorMessage,
  normalizeDomain,
  senderDraftError,
  senderErrorMessage,
  senderPayload,
  SENDERS_ENDPOINT,
  sendersUrl,
  senderUrl,
  toDomainView,
  toDomainViews,
  toSenderView,
  toSenderViews,
  verifyResultMessage,
  verifyUrl,
} from '../../resources/data/sending-query'

async function source(path: string): Promise<string> {
  return Bun.file(new URL(`../../${path}`, import.meta.url)).text()
}

const DOMAIN_INPUTS = [
  'mail.example.com', ' Mail.Example.COM. ', 'example.com', 'a-b.example.co.uk', 'xn--bcher-kva.example',
  '', 'localhost', 'http://example.com', 'example.com/path', 'hello@example.com', '192.168.1.1', '-bad.example.com',
  'bad-.example.com', 'exa mple.com', 'example..com', `${'a'.repeat(64)}.com`, `${'a.'.repeat(130)}com`, null, undefined, 42,
]

describe('reading a domain', () => {
  test('it is stored lowercase, without a trailing dot', () => {
    expect(serverNormalizeDomain(' Mail.Example.COM. ')).toBe('mail.example.com')
    expect(serverNormalizeDomain('xn--bcher-kva.example')).toBe('xn--bcher-kva.example')
  })

  test('addresses, URLs, IP literals and single labels are not domains', () => {
    for (const value of ['', 'localhost', 'http://example.com', 'example.com/path', 'hello@example.com', '192.168.1.1', '-bad.example.com', 'example..com'])
      expect(serverNormalizeDomain(value)).toBeUndefined()
  })

  test('the page reads a domain exactly as the server does', () => {
    for (const value of DOMAIN_INPUTS)
      expect(normalizeDomain(value)).toBe(serverNormalizeDomain(value))
    for (const value of ['hello@example.com', ' Maya@Mail.Example.com ', 'no-at.example.com', '@example.com', 'a b@example.com', 'x@localhost', null])
      expect(domainOfAddress(value)).toBe(serverDomainOfAddress(value))
  })

  test('an address gives its domain', () => {
    expect(serverDomainOfAddress('Maya@Mail.Example.com')).toBe('mail.example.com')
    expect(serverDomainOfAddress('@example.com')).toBeUndefined()
  })
})

describe('the ownership record', () => {
  test('it is a TXT record under the domain carrying a random token', () => {
    const token = newVerificationToken()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(newVerificationToken()).not.toBe(token)
    expect(verificationRecord('mail.example.com', token)).toEqual({ type: 'TXT', host: '_commshq-verify.mail.example.com', value: `${VERIFICATION_PREFIX}${token}` })
  })

  test('it is read back from the row, as a string or an array', () => {
    const record = verificationRecord('example.com', 'abc123')
    expect(storedVerification(JSON.stringify([record]))).toEqual(record)
    expect(storedVerification([record])).toEqual(record)
  })

  test('a row without one of ours cannot be verified against anything', () => {
    for (const value of [null, '', 'not json', '[]', '{}', JSON.stringify([{ type: 'CNAME', host: '_commshq-verify.example.com', value: 'commshq-verify=x' }]), JSON.stringify([{ type: 'TXT', host: 'example.com', value: 'commshq-verify=x' }]), JSON.stringify([{ type: 'TXT', host: '_commshq-verify.example.com', value: 'commshq-verify=' }])])
      expect(storedVerification(value)).toBeUndefined()
  })

  test('a DNS answer matches only on the exact value', () => {
    const expected = 'commshq-verify=abc123'
    expect(txtAnswerMatches([['v=spf1 -all'], [expected]], expected)).toBe(true)
    // One record split into chunks, as resolvers return long ones.
    expect(txtAnswerMatches([['commshq-verify=', 'abc123']], expected)).toBe(true)
    expect(txtAnswerMatches([[` ${expected} `]], expected)).toBe(true)
    expect(txtAnswerMatches([['commshq-verify=abc1234']], expected)).toBe(false)
    expect(txtAnswerMatches([['x commshq-verify=abc123']], expected)).toBe(false)
    expect(txtAnswerMatches([], expected)).toBe(false)
    expect(txtAnswerMatches(null, expected)).toBe(false)
    expect(txtAnswerMatches([[expected]], '')).toBe(false)
  })

  test('only owners and admins manage sending', () => {
    expect(['owner', 'Admin', 'member', 'viewer', '', null].map(role => canManageSending(role))).toEqual([true, true, false, false, false, false])
  })
})

describe('no request body verifies anything', () => {
  test('sender domains are served by the app actions, not the generated CRUD', async () => {
    const routes = await source('routes/api.ts')
    expect(routes).toContain("route.get('/v1/sender-domains', 'Actions/Api/V1/Sending/ListSenderDomainsAction')")
    expect(routes).toContain("route.post('/v1/sender-domains/{id}/verify', 'Actions/Api/V1/Sending/VerifySenderDomainAction')")
    // The framework model declares `status` fillable, so it must stay out of
    // the API selection.
    expect(await source('config/security.ts')).not.toContain('SenderDomain')
  })

  test('creating a domain reads the domain and nothing else from the request', async () => {
    const create = await source('app/Actions/Api/V1/Sending/CreateSenderDomainAction.ts')
    expect(create.match(/request\.get\(/g) ?? []).toHaveLength(1)
    expect(create).toContain("request.get('domain')")
    expect(create).toContain("status: 'pending'")
  })

  test('verifying compares DNS to the stored record, not to anything sent', async () => {
    const verify = await source('app/Actions/Api/V1/Sending/VerifySenderDomainAction.ts')
    expect(verify).not.toContain('request.get(')
    expect(verify).toContain('storedVerification(row.dns_records)')
    expect(verify).toContain('txtAnswerMatches(answer, record.value)')
  })

  test('a sender has no generated create or update, and its status is derived', async () => {
    const model = await source('app/Models/SenderIdentity.ts')
    expect(model).toContain("routes: ['index', 'show', 'destroy']")
    const create = await source('app/Actions/Api/V1/Sending/CreateSenderIdentityAction.ts')
    expect(create).not.toContain("request.get('status')")
    expect(create).toContain("const status = verified ? 'verified' : 'pending'")
  })

  test('the send job still requires a verified domain', async () => {
    expect(await source('app/Jobs/DispatchCampaign.ts')).toContain(".where('status', 'verified')")
  })
})

describe('the domains page', () => {
  const record = JSON.stringify([verificationRecord('mail.example.com', 'abc123')])

  test('it reads and writes the app routes', () => {
    expect(DOMAINS_ENDPOINT).toBe('/api/v1/sender-domains')
    expect(domainUrl(4)).toBe('/api/v1/sender-domains/4')
    expect(verifyUrl(4)).toBe('/api/v1/sender-domains/4/verify')
  })

  test('a pending domain shows the record to publish', () => {
    expect(toDomainView({ id: 1, domain: 'mail.example.com', status: 'pending', dns_records: record })).toMatchObject({
      statusLabel: 'Waiting for DNS',
      verified: false,
      recordHost: '_commshq-verify.mail.example.com',
      recordValue: 'commshq-verify=abc123',
      checkedLabel: 'Not checked yet',
    })
    expect(toDomainView({ id: 1, status: 'pending', dns_records: record, last_checked_at: '2026-11-10T09:00:00Z' }, 'en-US').checkedLabel).toBe('Last checked Nov 10, 2026, record not found')
  })

  test('a verified domain says when, and drops the record', () => {
    expect(toDomainView({ id: 2, domain: 'example.com', status: 'verified', dns_records: record, verified_at: '2026-11-11T09:00:00Z' }, 'en-US')).toMatchObject({ verified: true, statusLabel: 'Verified', recordHost: '', recordValue: '', checkedLabel: 'Verified Nov 11, 2026' })
  })

  test('a row with no record, or none at all, still renders', () => {
    expect(toDomainView({ id: 3, dns_records: 'not json' })).toMatchObject({ domain: 'Domain 3', recordHost: '', status: 'pending' })
    expect(toDomainViews(null)).toEqual([])
    expect(domainStatusLabel('odd')).toBe('Unknown')
  })

  test('the form refuses what the endpoint would', () => {
    expect(domainDraftError('mail.example.com')).toBe('')
    expect(domainDraftError('')).toContain('Enter the domain')
    expect(domainDraftError('hello@example.com')).toContain('domain only')
    expect(domainDraftError('https://example.com')).toContain('not a domain')
    expect(domainPayload(' Mail.Example.com ')).toEqual({ domain: 'mail.example.com' })
  })

  test('a check says whether the record was found', () => {
    expect(verifyResultMessage({ data: { verified: true } }, 'example.com')).toContain('is verified')
    expect(verifyResultMessage({ data: { verified: false } }, 'example.com')).toContain('not found yet')
    expect(verifyResultMessage(null, 'example.com')).toContain('not found yet')
  })
})

describe('the senders page', () => {
  const known = [{ domain: 'example.com', verified: true }, { domain: 'waiting.example.com', verified: false }]

  test('it lists email senders by name and removes by id', () => {
    expect(SENDERS_ENDPOINT).toBe('/api/v1/sender-identities')
    expect(Object.fromEntries(new URL(sendersUrl(), 'https://commshq.org').searchParams.entries())).toEqual({ per_page: '50', channel: 'email', sort: 'name,id' })
    expect(senderUrl(7)).toBe('/api/v1/sender-identities/7')
  })

  test('each sender says where it stands and what would change it', () => {
    expect(toSenderView({ id: 1, name: 'Maya', address: 'maya@example.com', status: 'verified' }, known)).toMatchObject({ verified: true, standing: 'Verified. Messages can be sent from this address.', replyLabel: 'Replies go to the same address' })
    expect(toSenderView({ id: 2, address: 'hi@waiting.example.com', status: 'pending' }, known).standing).toBe('Not verified. waiting.example.com is still waiting for its DNS record.')
    expect(toSenderView({ id: 3, address: 'hi@other.example.org', status: 'pending', reply_to: 'r@other.example.org' }, known)).toMatchObject({ standing: 'Not verified. Add other.example.org as a sending domain to use this address.', replyLabel: 'Replies go to r@other.example.org' })
    expect(toSenderView({ id: 4, address: '+15550100', status: 'pending' }, known).standing).toContain('not an address')
    expect(toSenderView({ id: 5, address: 'x@example.com', status: 'disabled' }, known).standing).toBe('This sender is not available.')
    expect(toSenderViews(null)).toEqual([])
  })

  test('the form asks for a name and an address', () => {
    expect(senderDraftError({ name: 'Maya', address: 'maya@example.com' })).toBe('')
    expect(senderDraftError({ name: '', address: 'maya@example.com' })).toContain('needs a name')
    expect(senderDraftError({ name: 'Maya', address: 'maya' })).toContain('email address')
    expect(senderDraftError({ name: 'Maya', address: 'maya@example.com', replyTo: 'nope' })).toContain('reply address')
    expect(senderPayload({ name: ' Maya ', address: 'Maya@Example.com', replyTo: '' })).toEqual({ name: 'Maya', address: 'maya@example.com' })
    expect(senderPayload({ name: 'Maya', address: 'm@example.com', replyTo: 'R@example.com' }).replyTo).toBe('r@example.com')
  })

  test('each failure names what happened', () => {
    expect(listErrorMessage(401, 'senders')).toContain('see your senders')
    expect(listErrorMessage(503, 'sending domains')).toBe('Sending domains could not be loaded because the API is not answering.')
    expect(domainErrorMessage(409)).toContain('already registered')
    expect(domainErrorMessage(403)).toContain('owner or admin')
    expect(domainErrorMessage(503)).toContain('DNS could not be reached')
    expect(senderErrorMessage(409)).toContain('already has a sender')
    expect(senderErrorMessage(500)).toContain('(500)')
  })
})
