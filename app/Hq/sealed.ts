import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * A secret kept in the database under the application's key.
 *
 * A sending domain's DKIM private key has to be used again, on every message,
 * so unlike an app's key it cannot be kept as a hash. It is kept encrypted:
 * AES-256-GCM under a key derived from APP_KEY, so a copy of the table alone
 * signs nothing. Rotating APP_KEY makes the stored keys unreadable, and a
 * domain then needs a new key and a new DNS record.
 */

function keyFrom(secret: string): Buffer {
  if (!secret)
    throw new Error('APP_KEY is required to keep a signing key')
  return createHash('sha256').update(`commshq-sealed:${secret}`).digest()
}

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`
}

/** The secret, or null when it was sealed under another key or has been changed. */
export function unseal(sealed: string, secret: string): string | null {
  const [version, iv, tag, body] = String(sealed || '').split('.')
  if (version !== 'v1' || !iv || !tag || !body)
    return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  }
  catch {
    return null
  }
}
