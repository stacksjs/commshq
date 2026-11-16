import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The two keys an app connected with `buddy hq:connect commshq` holds.
 *
 * The send key lets the app send transactional email and add contacts, as
 * the app it was issued to and no other. The read key reads usage. Neither is
 * kept: the database holds a SHA-256 of each, so a copy of the table is not a
 * set of working keys, and a key that is lost is replaced, never recovered.
 *
 * The prefix says which kind a key is before anything is looked up, so a
 * read key offered to the send endpoint is refused by its shape.
 */

export type AppKeyKind = 'send' | 'read'

const PREFIX: Record<AppKeyKind, string> = { send: 'chq_send_', read: 'chq_read_' }
const BODY = /^[\w-]{43}$/

export function newAppKey(kind: AppKeyKind): string {
  return `${PREFIX[kind]}${randomBytes(32).toString('base64url')}`
}

/** Whether a presented string has the shape of this kind of key. Says nothing about whether it is one. */
export function looksLikeAppKey(value: unknown, kind: AppKeyKind): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX[kind]) && BODY.test(value.slice(PREFIX[kind].length))
}

/** What is stored for a key. */
export function hashAppKey(key: string): string {
  return createHash('sha256').update(`commshq-app-key:${key}`).digest('hex')
}

/** The start of a key, to tell keys apart in a list without showing one. */
export function appKeyHint(key: string): string {
  return `${key.slice(0, 14)}...`
}

export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** The key in an `Authorization: Bearer` header, or null. */
export function bearerKey(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(String(header || '').trim())
  return match?.[1] ?? null
}
