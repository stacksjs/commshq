import type { AppStore, OutgoingMessage } from './apps'
import type { TxtLookup } from './sendingDomain'
import process from 'node:process'
import { resolveTxt } from 'node:dns/promises'
import { config } from '@stacksjs/config'
import { db } from '@stacksjs/database'
import * as emailPackage from '@stacksjs/email'
import { createHqService, sqlConnectCodeStore } from '@stacksjs/hq/service'
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

const IS_PG = (process.env.DB_CONNECTION ?? String((config as any).database?.default ?? 'sqlite')) === 'postgres'
type Row = Record<string, unknown>

/** Written with `?` and bound as `$n` on Postgres. */
function query(sql: string, params: unknown[] = []): Promise<Row[]> {
  let i = 0
  return db.unsafe(IS_PG ? sql.replace(/\?/g, () => `$${++i}`) : sql, params) as unknown as Promise<Row[]>
}

export const sqlAppStore: AppStore = createSqlAppStore({
  run: query,
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

/** Look a TXT name up. A name with no record is an answer, not a failure. */
export const lookupTxt: TxtLookup = async (host) => {
  try {
    return { answer: await resolveTxt(host), failed: false }
  }
  catch (error) {
    const code = String((error as { code?: unknown })?.code || '')
    return { answer: [], failed: !['ENOTFOUND', 'ENODATA'].includes(code) }
  }
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
  codes: sqlConnectCodeStore(db as any, { dialect: IS_PG ? 'postgres' : 'sqlite' }),
  origin: appOrigin,
})

export const hq = createHqService(commshqAdapter)
