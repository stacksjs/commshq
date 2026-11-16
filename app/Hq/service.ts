import type { AppStore, OutgoingMessage } from './apps'
import type { TxtLookup } from './sendingDomain'
import process from 'node:process'
import { resolve4, resolveNs, Resolver, resolveTxt } from 'node:dns/promises'
import { config } from '@stacksjs/config'
import { db } from '@stacksjs/database'
import * as emailPackage from '@stacksjs/email'
import { createHqService, sqlConnectCodeStore } from '@stacksjs/hq/service'
import { IS_POSTGRES, sqlRun } from '../Support/sqlRun'
import { createCommshqAdapter } from './apps'
import { createSqlAppStore } from './sqlStore'
import { DKIM_SELECTOR } from './sendingDomain'

/**
 * The HQ service wired to this app's database and mail server. routes/hq.ts
 * mounts its endpoints and the approve page (resources/views/cli/connect.stx)
 * calls `describeConnect`. The tables are the models ConnectedApp, AppKey,
 * AppSend, SenderDomainKey and HqConnectCode, whose migrations are generated
 * from them.
 */

export const sqlAppStore: AppStore = createSqlAppStore({
  run: sqlRun,
  appKey: () => String(config.app?.key || process.env.APP_KEY || ''),
  joinAudience: async (teamId, audienceId, contactId) => {
    const { joinAudience } = await import('../Support/audienceMembership')
    await joinAudience(teamId, audienceId, contactId, 'active')
  },
})

/** The public web origin with its scheme, no trailing slash. */
export function appOrigin(): string {
  const url = String(config.app?.url || 'https://commshq.org').replace(/\/+$/, '')
  return /^https?:\/\//.test(url) ? url : `https://${url}`
}

/** CommsHQ's own sender: what mail goes out from until an app's domain is ready, and the envelope sender of all of it. */
export function fallbackAddress(): string {
  return String(config.email?.from?.address || 'no-reply@commshq.org')
}

/**
 * Whether the installed mail driver signs a message on its way out.
 *
 * The signing option and the signer shipped in one framework release, so the
 * signer's presence in the package says the SMTP driver honours `dkim`. On an
 * older release this is false, and every app's mail goes out from CommsHQ's
 * own address: handing the driver a From on another domain that it then sent
 * unsigned would fail DMARC for that domain.
 */
export function canSignOutbound(): boolean {
  return typeof (emailPackage as Record<string, unknown>).signDkim === 'function'
}

/**
 * Look a TXT name up at the nameservers that serve its zone.
 *
 * Asking the machine's own resolver is asking a cache. A domain's records are
 * looked for moments after they are published, and the look made a minute
 * earlier, before they existed, is answered again from memory for as long as
 * the zone's negative TTL says: half an hour on a common setup. The records
 * were in DNS, every public resolver had them, and the domain still read as
 * unverified. The authoritative servers have nothing to remember.
 *
 * Falls back to the resolver where the zone's nameservers cannot be found or
 * reached. A name with no record is an answer, not a failure.
 */
export const lookupTxt: TxtLookup = host => lookupTxtWith(host, { resolveTxt, resolveNs, resolve4, authoritative: txtAt })

export interface TxtResolvers {
  resolveTxt: (host: string) => Promise<string[][]>
  resolveNs: (zone: string) => Promise<string[]>
  resolve4: (host: string) => Promise<string[]>
  /** Ask the servers at these addresses for the TXT records of a name. */
  authoritative: (addresses: string[], host: string) => Promise<string[][]>
}

const NO_RECORD = ['ENOTFOUND', 'ENODATA']

async function txtAt(addresses: string[], host: string): Promise<string[][]> {
  const resolver = new Resolver({ timeout: 4000, tries: 2 })
  resolver.setServers(addresses)
  return resolver.resolveTxt(host)
}

/** The nameserver addresses of the nearest zone above a name that has any. */
async function zoneServers(host: string, resolvers: TxtResolvers): Promise<string[]> {
  const labels = host.replace(/\.$/, '').split('.')
  // From the name's parent up to the registrable domain: `_dmarc.app.example.com` may sit in `app.example.com` or `example.com`.
  for (let i = 1; i <= labels.length - 2; i++) {
    try {
      const names = await resolvers.resolveNs(labels.slice(i).join('.'))
      const addresses = (await Promise.all(names.slice(0, 4).map(name => resolvers.resolve4(name).catch(() => [] as string[])))).flat()
      if (addresses.length > 0)
        return addresses
    }
    catch { /* not a zone of its own: look one label up */ }
  }
  return []
}

export async function lookupTxtWith(host: string, resolvers: TxtResolvers): Promise<{ answer: string[][], failed: boolean }> {
  const settle = async (ask: () => Promise<string[][]>): Promise<{ answer: string[][], failed: boolean }> => {
    try {
      return { answer: await ask(), failed: false }
    }
    catch (error) {
      return { answer: [], failed: !NO_RECORD.includes(String((error as { code?: unknown })?.code || '')) }
    }
  }

  const addresses = await zoneServers(host, resolvers).catch(() => [] as string[])
  if (addresses.length > 0) {
    const direct = await settle(() => resolvers.authoritative(addresses, host))
    // Reached, and it answered either way: that is the truth of the matter.
    if (!direct.failed)
      return direct
  }
  return settle(() => resolvers.resolveTxt(host))
}

/** Hand a message to the mail server, signed for its domain where it has one. */
export async function transport(message: OutgoingMessage): Promise<{ ok: boolean, messageId?: string, error?: string }> {
  const result = await emailPackage.mail.send({
    from: message.from,
    to: message.to,
    cc: message.cc.length > 0 ? message.cc : undefined,
    bcc: message.bcc.length > 0 ? message.bcc : undefined,
    replyTo: message.replyTo.length > 0 ? message.replyTo : undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
    tag: 'transactional',
    // Bounces come back to CommsHQ, and SPF is checked against CommsHQ's own
    // domain, whose record covers the mail server. The signature carries the
    // app's domain.
    envelopeFrom: fallbackAddress(),
    ...(message.signing ? { dkim: { domain: message.signing.domain, selector: DKIM_SELECTOR, privateKey: message.signing.privateKey } } : {}),
  } as any)
  return result?.success === false
    ? { ok: false, error: String(result.message || 'The mail server rejected the message') }
    : { ok: true, messageId: (result as { messageId?: string } | undefined)?.messageId }
}

export const commshqAdapter = createCommshqAdapter({
  store: sqlAppStore,
  codes: sqlConnectCodeStore(db as any, { dialect: IS_POSTGRES ? 'postgres' : 'sqlite' }),
  origin: appOrigin,
})

export const hq = createHqService(commshqAdapter)
