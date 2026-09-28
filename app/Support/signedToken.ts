import { createHmac, timingSafeEqual } from 'node:crypto'

export interface PublicTokenPayload {
  teamId: number
  contactId: number
  channel: 'email' | 'sms'
  purpose: 'confirm' | 'preferences' | 'unsubscribe'
  expiresAt: number
  /**
   * The form a confirm link came from, so confirming can join the form's
   * audience and land on its success page. Absent on older links and on
   * unsubscribe links, which act on the whole channel.
   */
  formId?: number
}

function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function createPublicToken(payload: PublicTokenPayload, secret: string): string {
  if (!secret) throw new Error('A signing secret is required')
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signature(encoded, secret)}`
}

export function verifyPublicToken(token: string, secret: string, now = Date.now()): PublicTokenPayload | null {
  if (!token || !secret) return null
  const [encoded, supplied] = token.split('.', 2)
  if (!encoded || !supplied) return null
  const expected = signature(encoded, secret)
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as PublicTokenPayload
    if (!Number.isInteger(payload.teamId) || !Number.isInteger(payload.contactId) || payload.expiresAt < now) return null
    if (payload.formId !== undefined && !Number.isInteger(payload.formId)) return null
    return payload
  }
  catch {
    return null
  }
}
