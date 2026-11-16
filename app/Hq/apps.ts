import type { SendingCounts } from './standing'
import { dailyCap, healthProblem, messageProblem } from './standing'
import type { ConnectCodeStore, ConnectGrant, HqServiceAdapter, MeterReading, ReadPrincipal } from '@stacksjs/hq/service'
import type { DomainChecks, DomainRecord, TxtLookup } from './sendingDomain'
import { domainOfAddress, newVerificationToken, normalizeDomain } from '../Support/senderDomains'
import { generateDkimKeyPair } from '@stacksjs/email'
import { appKeyHint, hashAppKey, looksLikeAppKey, newAppKey } from './keys'
import { checkSendingDomain, recordsForApi, sendingDomainRecords } from './sendingDomain'

/**
 * CommsHQ's side of the HQ connect contract (`@stacksjs/hq/service`), and what
 * a connected app may do with its keys.
 *
 * `buddy hq:connect commshq` asks for a code, a signed-in person approves it
 * on /cli/connect, and the CLI collects a send key and a read key for an app
 * in that person's team. With the send key the app sends transactional email
 * and adds contacts. With the read key it reads the team's usage. Nothing
 * else: neither key opens the dashboard's API.
 *
 * Nothing in this file touches the database, DNS or a mail server. It is
 * handed stores and a transport, which is what lets the package's contract
 * suite and the tests run against the same code the routes use.
 */

export interface ConnectedApp {
  /** The public id, a UUID. */
  id: string
  teamId: number
  name: string
  /** The app's sending domain row, once it has registered one. */
  senderDomainId: number | null
  /** The address on its own domain the app last sent from: what mail CommsHQ sends for it is from. */
  fromAddress?: string | null
}

export interface SenderDomainRow {
  id: number
  teamId: number
  domain: string
  status: 'pending' | 'verified' | 'failed' | 'disabled'
  dnsRecords: unknown
  /** When the domain's DKIM record was last seen in DNS. Null until it has been. */
  dkimVerifiedAt: string | null
}

/** The form a connected app collects email addresses with, as its row has it. */
export interface SignupFormRow {
  /** The form's public id, a UUID: what `/forms/{id}/submit` is addressed by. */
  id: string
  status: 'draft' | 'active' | 'archived'
  /** The form's settings document: its fields, list name, allowed origins and where it sends people after. */
  document: Record<string, unknown>
  /** The public id of the audience a signup joins. */
  audienceId: string | null
}

export interface AppStore {
  /** The team a signed-in person acts for, with their role. Null when they have none. */
  teamOf: (userId: number) => Promise<{ teamId: number, role: string } | null>
  /**
   * Make a workspace for a person who has none, with them as its owner and
   * the free plan's allowance. Answers the team they act for afterwards.
   */
  createWorkspace: (userId: number) => Promise<{ teamId: number, role: string }>
  findApp: (teamId: number, name: string) => Promise<ConnectedApp | null>
  createApp: (teamId: number, name: string, userId: number) => Promise<ConnectedApp>
  addKey: (appId: string, kind: 'send' | 'read', keyHash: string, hint: string, userId: number | null) => Promise<void>
  /** The app a live key of this kind belongs to. A revoked key finds nothing. */
  findAppByKey: (kind: 'send' | 'read', keyHash: string) => Promise<ConnectedApp | null>
  findAppById: (teamId: number, appId: string) => Promise<ConnectedApp | null>
  /** Keep the address an app sent from on its own domain. */
  rememberFrom: (appId: string, address: string) => Promise<void>
  touchKey?: (keyHash: string) => Promise<void>

  findDomain: (domain: string) => Promise<SenderDomainRow | null>
  findDomainById: (id: number) => Promise<SenderDomainRow | null>
  /** Add a pending domain with its records and its sealed private key. */
  createDomain: (input: { teamId: number, domain: string, dnsRecords: unknown, publicKey: string, privateKey: string }) => Promise<SenderDomainRow>
  /** Give a domain that was added in the dashboard its signing key and records. */
  attachDomainKey: (domainId: number, input: { dnsRecords: unknown, publicKey: string, privateKey: string }) => Promise<SenderDomainRow>
  setAppDomain: (appId: string, domainId: number) => Promise<void>
  markDomainChecked: (domainId: number, checks: DomainChecks, now: string) => Promise<SenderDomainRow>
  /** The domain's private key, PEM. Null when it has none. */
  domainPrivateKey: (domainId: number) => Promise<string | null>

  /** The team's meters for the period that is open now. */
  meters: (teamId: number) => Promise<MeterReading[]>
  /** Count `quantity` against a meter if it fits. False when it does not, or there is no meter. */
  reserve: (teamId: number, meter: 'emails' | 'contacts', quantity: number) => Promise<boolean>
  /** Give back what was reserved for mail that was never sent. */
  release: (teamId: number, meter: 'emails' | 'contacts', quantity: number) => Promise<void>

  /** Which of these addresses the team must not write to. */
  suppressed: (teamId: number, recipients: string[]) => Promise<string[]>

  /** A send already made under this key, if there was one. */
  /** What the app and its workspace have sent lately, and whether the app is paused. */
  sendingCounts: (appId: string, teamId: number, now: Date) => Promise<SendingCounts>
  /** Stop the app's sending until a person lifts it. */
  pauseSending: (appId: string, reason: string, now: Date) => Promise<void>
  findSend: (appId: string, idempotencyKey: string) => Promise<SendRecord | null>
  recordSend: (appId: string, teamId: number, record: SendRecord & { idempotencyKey: string | null, recipients: string[], subject: string }) => Promise<void>

  upsertContact: (teamId: number, input: ContactInput) => Promise<{ id: string, created: boolean }>
  /** The team's audience of this id. */
  joinAudience: (teamId: number, audience: string, contactId: string) => Promise<boolean>

  /** The team's form of this slug, if it has one. */
  findSignupForm: (teamId: number, slug: string) => Promise<SignupFormRow | null>
  /** Add an active, double opt-in form, and the audience it fills where the team has none of that name. */
  createSignupForm: (input: { teamId: number, slug: string, name: string, audienceName: string, document: Record<string, unknown> }) => Promise<SignupFormRow>
  setSignupFormDocument: (teamId: number, slug: string, document: Record<string, unknown>) => Promise<void>
}

export interface HqUser {
  id: number | string
}

export class ConnectRefusedError extends Error {
  constructor(message: string, public reason: 'role') {
    super(message)
    this.name = 'ConnectRefusedError'
  }
}

export interface CommshqAdapterDeps {
  store: AppStore
  codes: ConnectCodeStore
  /** Public web origin, no trailing slash. */
  origin: () => string
}

export function createCommshqAdapter(deps: CommshqAdapterDeps): HqServiceAdapter<HqUser> {
  const { store } = deps

  async function provision(user: HqUser, { app }: { app: string }): Promise<ConnectGrant> {
    const userId = Number(user.id)
    if (!Number.isFinite(userId))
      throw new TypeError('A connect can only be approved by a signed-in user.')

    // Somebody with no workspace is given one, as its owner. They used to be
    // told to create one and run the command again, and there is nowhere in
    // the app to create one: the connect was a dead end for every new account.
    const membership = await store.teamOf(userId) ?? await store.createWorkspace(userId)
    // A send key puts mail out under the workspace's name and spends its
    // allowance, which is the same trust as setting up sending.
    if (!['owner', 'admin'].includes(membership.role.toLowerCase()))
      throw new ConnectRefusedError('Connecting an app needs an admin or owner of the workspace.', 'role')

    const found = await store.findApp(membership.teamId, app) ?? await store.createApp(membership.teamId, app, userId)

    // A new pair every time, beside the ones already issued. The keys are not
    // kept, so there is nothing to hand out again, and connecting a second
    // machine must not stop the first one's deployment sending.
    const sendKey = newAppKey('send')
    const readKey = newAppKey('read')
    await store.addKey(found.id, 'send', hashAppKey(sendKey), appKeyHint(sendKey), userId)
    await store.addKey(found.id, 'read', hashAppKey(readKey), appKeyHint(readKey), userId)

    return {
      project: { id: found.id, name: found.name },
      ingestKey: sendKey,
      readKey,
      dashboardUrl: `${deps.origin()}/dashboard/settings?app=${encodeURIComponent(found.id)}`,
    }
  }

  async function authenticateReadKey(presented: string): Promise<ReadPrincipal | null> {
    // Shape first: a send key, a session token or anything else never reaches
    // the lookup, so none of them can be tried as a read key.
    if (!looksLikeAppKey(presented, 'read'))
      return null
    const hash = hashAppKey(presented)
    const app = await store.findAppByKey('read', hash)
    if (!app)
      return null
    await store.touchKey?.(hash).catch(() => {})
    // Usage is the workspace's, so the team is the principal.
    return { owner: String(app.teamId), project: app.id }
  }

  return {
    service: 'commshq',
    approveUrl: code => `${deps.origin()}/cli/connect?code=${encodeURIComponent(code)}`,
    upgradeUrl: () => `${deps.origin()}/pricing`,
    codes: deps.codes,
    provision,
    authenticateReadKey,
    async usage(principal) {
      const teamId = Number(principal.owner)
      if (!Number.isFinite(teamId))
        return []
      return store.meters(teamId)
    },
  }
}

/** The app a send key belongs to, or null. */
export async function authenticateSendKey(store: AppStore, presented: unknown): Promise<ConnectedApp | null> {
  if (!looksLikeAppKey(presented, 'send'))
    return null
  const hash = hashAppKey(presented)
  const app = await store.findAppByKey('send', hash)
  if (app)
    await store.touchKey?.(hash).catch(() => {})
  return app
}

// --- The sending domain ---

export interface SendingDomainAnswer {
  domain: string
  status: SenderDomainRow['status']
  /** The address mail is sent from now. */
  from: string
  records: DomainRecord[]
  checks?: { ownership: boolean, dkim: boolean }
}

export type DomainResult
  = | { ok: true, data: SendingDomainAnswer }
    | { ok: false, status: number, error: string }

export interface DomainDeps {
  store: AppStore
  lookupTxt: TxtLookup
  /** The address CommsHQ sends from for an app whose domain is not verified. */
  fallbackFrom: (app: ConnectedApp) => string
  now?: () => Date
}

/** A domain is usable for an app's From line once it is verified and its key has been seen in DNS. */
export function domainIsReady(row: SenderDomainRow | null): row is SenderDomainRow {
  return !!row && row.status === 'verified' && !!row.dkimVerifiedAt
}

function describe(app: ConnectedApp, row: SenderDomainRow, deps: DomainDeps, checks?: DomainChecks): SendingDomainAnswer {
  const ready = domainIsReady(row)
  return {
    domain: row.domain,
    // To an app, a domain whose key is not in DNS yet is not one it can send from.
    status: row.status === 'verified' && !ready ? 'pending' : row.status,
    from: ready ? `noreply@${row.domain}` : deps.fallbackFrom(app),
    records: recordsForApi(row.dnsRecords),
    ...(checks ? { checks: { ownership: checks.ownership, dkim: checks.dkim } } : {}),
  }
}

/**
 * Register the domain an app wants to send from, or answer the one it has.
 *
 * Always as it is in the database: there is no body that makes a domain
 * verified. The first registration makes the domain's signing key, and the
 * records are the same on every later call, so a deploy can ask each time.
 */
export async function registerSendingDomain(app: ConnectedApp, requested: unknown, deps: DomainDeps): Promise<DomainResult> {
  const domain = normalizeDomain(requested)
  if (!domain)
    return { ok: false, status: 422, error: 'domain must be a hostname such as example.com' }

  let row = await deps.store.findDomain(domain)
  // One workspace per domain, as the dashboard has it.
  if (row && row.teamId !== app.teamId)
    return { ok: false, status: 409, error: 'This domain is registered to another workspace' }
  if (row?.status === 'disabled')
    return { ok: false, status: 409, error: 'This domain is disabled' }

  if (!row) {
    const keys = generateDkimKeyPair()
    row = await deps.store.createDomain({
      teamId: app.teamId,
      domain,
      dnsRecords: sendingDomainRecords(domain, newVerificationToken(), keys.record),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
    })
  }
  else if (!(await deps.store.domainPrivateKey(row.id))) {
    // Added in the dashboard, where a domain has only its ownership record.
    // It keeps that record, and its token, and gains a key.
    const keys = generateDkimKeyPair()
    const ownership = recordsForApi(row.dnsRecords).find(record => record.purpose === 'ownership')
    const token = ownership?.content.replace(/^commshq-verify=/, '') || newVerificationToken()
    row = await deps.store.attachDomainKey(row.id, {
      dnsRecords: sendingDomainRecords(domain, token, keys.record),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
    })
  }

  if (app.senderDomainId !== row.id)
    await deps.store.setAppDomain(app.id, row.id)

  return { ok: true, data: describe(app, row, deps) }
}

/** Look the app's domain up in DNS and record what was found. */
export async function verifySendingDomain(app: ConnectedApp, requested: unknown, deps: DomainDeps): Promise<DomainResult> {
  const domain = normalizeDomain(requested)
  const row = domain ? await deps.store.findDomain(domain) : null
  if (!row || row.teamId !== app.teamId)
    return { ok: false, status: 404, error: 'Register the domain first' }
  if (row.status === 'disabled')
    return { ok: false, status: 409, error: 'This domain is disabled' }

  const checks = await checkSendingDomain(row.dnsRecords, deps.lookupTxt)
  if (checks.unreachable)
    return { ok: false, status: 503, error: 'DNS could not be reached to check this domain. Try again shortly.' }

  const updated = await deps.store.markDomainChecked(row.id, checks, (deps.now?.() ?? new Date()).toISOString())
  return { ok: true, data: describe(app, updated, deps, checks) }
}

// --- Sending ---

export interface SendRecord {
  id: string
  from: string
  /** `domain` when sent from the app's own verified domain, `fallback` when from CommsHQ's. */
  authenticated: 'domain' | 'fallback'
  status: 'sent' | 'failed'
  accepted: string[]
  suppressed: string[]
}

export interface OutgoingMessage {
  from: { name: string, address: string }
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo: string[]
  subject: string
  html?: string
  text?: string
  headers: Record<string, string>
  /** Set when the message goes out from the app's own domain. */
  signing?: { domain: string, privateKey: string }
}

export interface SendDeps {
  store: AppStore
  /** Hand a message to the mail server. Answers the server's id for it. */
  transport: (message: OutgoingMessage) => Promise<{ ok: boolean, messageId?: string, error?: string }>
  /** CommsHQ's own sender, used until an app's domain is ready. */
  fallbackAddress: () => string
  /** False when the installed mail driver cannot sign on the way out: then nothing is sent from an app's domain. */
  canSign: () => boolean
  newId?: () => string
  now?: () => Date
  /** Tell the workspace's owners their app was paused, and why. Never fails a send. */
  notifyPaused?: (app: ConnectedApp, reason: string) => Promise<void>
  /** Counts one message to one address; false once the address has had its hour's worth. */
  recipientAllowed?: (appId: string, address: string, now: Date) => boolean
}

export type SendResult
  = | { ok: true, status: 200 | 202, data: SendRecord, replayed?: boolean }
    | { ok: false, status: number, error: string }

const MAX_RECIPIENTS = 50
const MAX_SUBJECT = 998
const MAX_HTML = 500_000
const MAX_TEXT = 200_000
const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

/** An address out of `a@b.co` or `Name <a@b.co>`, lower-cased, or undefined. */
export function addressOf(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value : (value && typeof value === 'object' ? String((value as { address?: unknown }).address ?? '') : '')
  const angled = /<([^<>]+)>\s*$/.exec(text)
  const address = (angled ? angled[1]! : text).trim().toLowerCase()
  return address.length <= 254 && ADDRESS.test(address) ? address : undefined
}

function addresses(value: unknown): { list: string[], bad: boolean } {
  const items = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
  const list: string[] = []
  let bad = false
  for (const item of items) {
    const address = addressOf(item)
    if (address)
      list.push(address)
    else
      bad = true
  }
  return { list: [...new Set(list)], bad }
}

/** A display name that cannot break out of a header. */
export function safeName(value: unknown, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const name = String(value ?? '').replace(/[\u0000-\u001F\u007F"<>\\]/g, '').trim().slice(0, 120)
  return name || fallback
}

/** Headers an app may add: its own `X-` fields, and the list-unsubscribe pair. Everything else is CommsHQ's to set. */
export function allowedHeaders(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return out
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string' || raw.length > 998 || /[\r\n]/.test(raw))
      continue
    if (!/^(?:X-[A-Za-z0-9-]{1,60}|List-Unsubscribe|List-Unsubscribe-Post)$/i.test(name))
      continue
    out[name] = raw
    if (Object.keys(out).length >= 20)
      break
  }
  return out
}

/**
 * Send one transactional email for an app.
 *
 * The app says who the mail is from. Whether that address is used is decided
 * here: only when its domain is the app's, verified, with its key seen in
 * DNS. Otherwise the mail goes out from CommsHQ's own address under the app's
 * name, with replies sent to the address the app asked for, so nothing leaves
 * under a domain that has not said it may.
 */
export async function sendForApp(app: ConnectedApp, body: unknown, deps: SendDeps): Promise<SendResult> {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const { store } = deps

  const to = addresses(input.to)
  const cc = addresses(input.cc)
  const bcc = addresses(input.bcc)
  const replyTo = addresses(input.replyTo)
  if (to.bad || cc.bad || bcc.bad || replyTo.bad)
    return { ok: false, status: 422, error: 'Every recipient must be an email address' }
  if (to.list.length === 0)
    return { ok: false, status: 422, error: 'to is required' }
  const everyone = [...new Set([...to.list, ...cc.list, ...bcc.list])]
  if (everyone.length > MAX_RECIPIENTS)
    return { ok: false, status: 422, error: `A message may have at most ${MAX_RECIPIENTS} recipients` }

  const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
  if (!subject || subject.length > MAX_SUBJECT || /[\r\n]/.test(subject))
    return { ok: false, status: 422, error: 'subject is required, on one line' }
  const html = typeof input.html === 'string' && input.html ? input.html : undefined
  const text = typeof input.text === 'string' && input.text ? input.text : undefined
  if (!html && !text)
    return { ok: false, status: 422, error: 'html or text is required' }
  if ((html?.length ?? 0) > MAX_HTML || (text?.length ?? 0) > MAX_TEXT)
    return { ok: false, status: 413, error: 'The message is too large' }

  const idempotencyKey = typeof input.idempotencyKey === 'string' && /^[\w.:@/-]{1,200}$/.test(input.idempotencyKey) ? input.idempotencyKey : null
  if (input.idempotencyKey !== undefined && !idempotencyKey)
    return { ok: false, status: 422, error: 'idempotencyKey must be 1 to 200 letters, digits or . : @ / _ -' }
  if (idempotencyKey) {
    const earlier = await store.findSend(app.id, idempotencyKey)
    // The same key is the same message: answered as it went the first time.
    if (earlier && earlier.status === 'sent')
      return { ok: true, status: 200, data: earlier, replayed: true }
  }

  const blocked = new Set(await store.suppressed(app.teamId, everyone))
  const keep = (list: string[]): string[] => list.filter(address => !blocked.has(address))
  const accepted = { to: keep(to.list), cc: keep(cc.list), bcc: keep(bcc.list) }
  const acceptedAll = [...new Set([...accepted.to, ...accepted.cc, ...accepted.bcc])]
  const suppressed = everyone.filter(address => blocked.has(address))
  if (accepted.to.length === 0)
    return { ok: false, status: 422, error: 'Every recipient in to is suppressed: they bounced, complained or unsubscribed' }

  // Who it is from.
  const asked = (input.from && typeof input.from === 'object' ? input.from : { address: input.from }) as { name?: unknown, address?: unknown }
  const askedAddress = addressOf(asked.address)
  const domainRow = app.senderDomainId ? await store.findDomainById(app.senderDomainId) : null
  const privateKey = domainIsReady(domainRow) && deps.canSign() ? await store.domainPrivateKey(domainRow.id) : null
  const ownDomain = privateKey && domainRow ? domainRow.domain : null
  const askedDomain = askedAddress ? domainOfAddress(askedAddress) : undefined
  const fromOwn = !!ownDomain && (!askedAddress || askedDomain === ownDomain || askedDomain?.endsWith(`.${ownDomain}`) === true)

  // Whether this app's mail should go out at all. CommsHQ's addresses are
  // shared by every app that sends through it, so what one app sends decides
  // where everybody's mail lands (see ./standing).
  const now = deps.now?.() ?? new Date()
  const counts = await store.sendingCounts(app.id, app.teamId, now)
  if (counts.pausedReason)
    return { ok: false, status: 403, error: `Sending for ${app.name} is paused: ${counts.pausedReason}. Nothing was sent. Contact CommsHQ support to have it reviewed.` }
  const unhealthy = healthProblem(counts)
  if (unhealthy) {
    await store.pauseSending(app.id, unhealthy, now)
    await deps.notifyPaused?.(app, unhealthy).catch(() => {})
    return { ok: false, status: 403, error: `Sending for ${app.name} has been paused: ${unhealthy}. Nothing was sent. Contact CommsHQ support to have it reviewed.` }
  }
  const shape = messageProblem({ fromName: safeName(asked.name, app.name), ownDomain: fromOwn ? ownDomain : null, html, text })
  if (shape)
    return { ok: false, status: 422, error: shape }
  const cap = dailyCap({ ownDomain: fromOwn, firstSentAt: counts.firstSentAt, now })
  if (counts.sentLastDay + acceptedAll.length > cap) {
    const why = fromOwn
      ? 'A new sending domain earns volume over its first month, the way mailbox providers expect it to grow'
      : 'Mail from CommsHQ\'s shared address is limited; verify your own sending domain to send more'
    return { ok: false, status: 429, error: `This workspace may reach ${cap} recipients in 24 hours for now, and has reached ${counts.sentLastDay}. ${why}.` }
  }
  const allowed = deps.recipientAllowed
  if (allowed) {
    const flooded = acceptedAll.filter(address => !allowed(app.id, address, now))
    if (flooded.length > 0)
      return { ok: false, status: 429, error: `Too many messages to ${flooded[0]} in the last hour` }
  }

  const ownFrom = { name: safeName(asked.name, app.name), address: askedAddress ?? `noreply@${ownDomain}` }
  const sharedFrom = { name: `${safeName(asked.name, app.name)} via CommsHQ`, address: deps.fallbackAddress() }
  // From CommsHQ's address a reply would reach CommsHQ. It goes to the app.
  const repliesFor = (own: boolean): string[] => replyTo.list.length > 0 ? replyTo.list : (!own && askedAddress ? [askedAddress] : [])

  if (!(await store.reserve(app.teamId, 'emails', acceptedAll.length)))
    return { ok: false, status: 402, error: 'The workspace has no email allowance left for this period' }

  const id = deps.newId?.() ?? crypto.randomUUID()
  type Sent = { ok: boolean, messageId?: string, error?: string }
  const hand = (own: boolean): Promise<Sent> => deps.transport({
    from: own ? ownFrom : sharedFrom,
    to: accepted.to,
    cc: accepted.cc,
    bcc: accepted.bcc,
    replyTo: repliesFor(own),
    subject,
    html,
    text,
    headers: { ...allowedHeaders(input.headers), 'X-CommsHQ-Message': id },
    ...(own && ownDomain && privateKey ? { signing: { domain: ownDomain, privateKey } } : {}),
  }).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }) as Sent)

  let own = fromOwn
  let sent = await hand(own)
  // A mail server that will not carry the app's own address still carries
  // CommsHQ's. The message matters more than whose name is on it, and the
  // answer says which it was.
  if (!sent.ok && own) {
    own = false
    sent = await hand(own)
  }
  const from = own ? ownFrom : sharedFrom

  const record: SendRecord = {
    id,
    from: `${from.name} <${from.address}>`,
    authenticated: own ? 'domain' : 'fallback',
    status: sent.ok ? 'sent' : 'failed',
    accepted: acceptedAll,
    suppressed,
  }
  await store.recordSend(app.id, app.teamId, { ...record, idempotencyKey, recipients: acceptedAll, subject })

  if (sent.ok && own && app.fromAddress !== from.address)
    await store.rememberFrom(app.id, from.address).catch(() => {})

  if (!sent.ok) {
    await store.release(app.teamId, 'emails', acceptedAll.length)
    return { ok: false, status: 502, error: 'The mail server did not accept the message. Nothing was sent, and it can be sent again.' }
  }
  return { ok: true, status: 202, data: record }
}

// --- Mail CommsHQ sends for an app ---

export interface AppSender {
  from: { name: string, address: string }
  signing: { domain: string, privateKey: string }
}

/**
 * Who mail that CommsHQ itself writes for an app is from: a signup form's
 * confirmation, say. The app's own address, signed with its domain's key,
 * once that domain is ready; null until then, and the caller sends as
 * CommsHQ. The address is the one the app last sent from, or `noreply@` its
 * domain when it has not sent yet.
 */
export async function senderForApp(store: AppStore, teamId: number, appId: string, canSign: () => boolean): Promise<AppSender | null> {
  const app = await store.findAppById(teamId, appId)
  if (!app?.senderDomainId || !canSign())
    return null
  const row = await store.findDomainById(app.senderDomainId)
  if (!domainIsReady(row) || row.teamId !== teamId)
    return null
  const privateKey = await store.domainPrivateKey(row.id)
  if (!privateKey)
    return null
  const remembered = app.fromAddress && (domainOfAddress(app.fromAddress) === row.domain || domainOfAddress(app.fromAddress)?.endsWith(`.${row.domain}`)) ? app.fromAddress : null
  return { from: { name: safeName(app.name, 'CommsHQ'), address: remembered ?? `noreply@${row.domain}` }, signing: { domain: row.domain, privateKey } }
}

// --- The signup form ---

export interface SignupFormAnswer {
  /** The form's public id. */
  id: string
  /** Where a page posts an email address to. */
  submitUrl: string
  /** The audience a confirmed signup joins. */
  audienceId: string | null
}

export type SignupFormResult
  = | { ok: true, data: SignupFormAnswer }
    | { ok: false, status: number, error: string }

/** A site's origin, when it is one a signup may come from: https, a host, nothing else. */
export function siteOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 300)
    return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.'))
      return undefined
    // An origin, and not a page on one: a path or a query here is a mistake to say, not to drop.
    if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash)
      return undefined
    return url.origin
  }
  catch {
    return undefined
  }
}

/** The slug of an app's own form. From the app's id, so a second call finds the first one's form. */
export function signupFormSlug(app: ConnectedApp): string {
  return `app-${app.id}`.toLowerCase().slice(0, 120)
}

/**
 * The form an app collects email addresses with: made the first time it is
 * asked for, and the same one every time after.
 *
 * An app's key may add a contact, and may not say the person agreed to be
 * written to. This is how an app gets that agreement properly: its page posts
 * the address to CommsHQ's own public form endpoint, which records the
 * consent, sends the confirmation and adds the person once they confirm. The
 * form takes signups from the app's site and from nowhere else.
 */
export async function signupFormForApp(app: ConnectedApp, body: unknown, deps: { store: AppStore, origin: () => string }): Promise<SignupFormResult> {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const site = siteOrigin(input.origin)
  if (!site)
    return { ok: false, status: 422, error: 'origin must be the https origin of the site the form is on, such as https://example.com' }
  const asked = typeof input.listName === 'string' && input.listName.trim() ? input.listName.trim().slice(0, 120) : undefined

  const slug = signupFormSlug(app)
  // `connectedApp` is what lets the confirmation come from the app's own address.
  const settings = { successUrl: `${site}/?subscribed=1`, allowedOrigins: [site], connectedApp: app.id }
  let form = await deps.store.findSignupForm(app.teamId, slug)

  if (!form) {
    form = await deps.store.createSignupForm({
      teamId: app.teamId,
      slug,
      name: `${app.name} signup`.slice(0, 160),
      audienceName: `${app.name} subscribers`.slice(0, 120),
      document: { fields: [{ name: 'email', type: 'email', required: true }], listName: asked ?? app.name, ...settings },
    })
  }
  else {
    // Archived or set back to a draft in the dashboard is a decision made
    // there. A key does not undo it.
    if (form.status !== 'active')
      return { ok: false, status: 409, error: 'This app\'s signup form is not active. Activate it in the dashboard to take signups again.' }
    const current = form.document
    const origins = Array.isArray(current.allowedOrigins) ? current.allowedOrigins : []
    const changed = current.successUrl !== settings.successUrl || origins.length !== 1 || origins[0] !== site || current.connectedApp !== app.id || (asked !== undefined && current.listName !== asked)
    // Everything else in the document is kept: its fields, and a sender chosen in the dashboard.
    if (changed)
      await deps.store.setSignupFormDocument(app.teamId, slug, { ...current, ...(asked !== undefined ? { listName: asked } : {}), ...settings })
  }

  return { ok: true, data: { id: form.id, submitUrl: `${deps.origin()}/forms/${encodeURIComponent(form.id)}/submit`, audienceId: form.audienceId } }
}

// --- Contacts ---

export interface ContactInput {
  email: string
  firstName?: string
  lastName?: string
  properties?: Record<string, string | number | boolean | null>
  source: string
}

export type ContactResult
  = | { ok: true, status: 200 | 201, data: { id: string, email: string, created: boolean, audience: boolean } }
    | { ok: false, status: number, error: string }

/** Properties an app may set on a contact: flat, small, and scalar. */
function properties(value: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[\w.-]{1,60}$/.test(key))
      continue
    if (raw === null || typeof raw === 'number' || typeof raw === 'boolean' || (typeof raw === 'string' && raw.length <= 1000))
      out[key] = raw
    if (Object.keys(out).length >= 50)
      break
  }
  return out
}

/**
 * Add a contact to the app's workspace, or update the one with that address.
 *
 * It does not record consent. A contact added here can be written to with
 * transactional mail, and campaigns still go only to people whose consent is
 * on the ledger, which a key held by an app is not trusted to assert.
 */
export async function upsertContactForApp(app: ConnectedApp, body: unknown, deps: { store: AppStore }): Promise<ContactResult> {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const email = addressOf(input.email)
  if (!email)
    return { ok: false, status: 422, error: 'email must be an email address' }
  const name = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined)

  const contact = await deps.store.upsertContact(app.teamId, {
    email,
    firstName: name(input.firstName),
    lastName: name(input.lastName),
    properties: properties(input.properties),
    source: `app:${app.name}`.slice(0, 100),
  })

  // Counted, and kept whether or not it fits: refusing would lose the address,
  // and the count is what the workspace's plan page already reports as over.
  if (contact.created)
    await deps.store.reserve(app.teamId, 'contacts', 1)

  let audience = false
  if (typeof input.audience === 'string' && input.audience)
    audience = await deps.store.joinAudience(app.teamId, input.audience, contact.id)

  return { ok: true, status: contact.created ? 201 : 200, data: { id: contact.id, email, created: contact.created, audience } }
}
