/**
 * What a signup form does beyond collecting an address, read from its
 * `schemaDocument`.
 *
 * A form is embedded on somebody else's site, so it has to answer questions
 * the workspace cannot: whose name the confirmation email carries, where the
 * reader lands once they click it, and which sites may post to it. Those live
 * on the form, next to the fields, rather than in columns, because they are
 * part of what the form is. Every key is optional; a form without them
 * behaves as it always did.
 *
 * ```json
 * {
 *   "fields": [{ "name": "email", "type": "email", "required": true }],
 *   "listName": "Chris Breuer",
 *   "senderIdentityId": 3,
 *   "successUrl": "https://chrisbreuer.me/?subscribed=1",
 *   "allowedOrigins": ["https://chrisbreuer.me"]
 * }
 * ```
 */
export interface FormSettings {
  /** How the list is named to a subscriber: "Confirm your subscription to …". */
  listName?: string
  /** A verified SenderIdentity in the form's team; the confirmation's From. */
  senderIdentityId?: number
  /** Where a confirmed subscriber is sent. Must be http(s). */
  successUrl?: string
  /**
   * Sites whose pages may sign people up through this form. Empty means any:
   * the form's id is already public in the page that embeds it. CORS itself is
   * answered by the router for every origin; this is the check that decides.
   */
  allowedOrigins: string[]
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim())
    return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  }
  catch {
    return undefined
  }
}

/** An origin as a browser sends it: scheme, host and port, nothing else. */
export function normalizeOrigin(value: unknown): string | undefined {
  const url = httpUrl(value)
  return url ? new URL(url).origin : undefined
}

export function parseFormSettings(schemaDocument: unknown): FormSettings {
  let doc: Record<string, unknown> = {}
  try {
    const parsed = typeof schemaDocument === 'string' ? JSON.parse(schemaDocument) : schemaDocument
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      doc = parsed as Record<string, unknown>
  }
  catch {}

  const listName = typeof doc.listName === 'string' && doc.listName.trim() ? doc.listName.trim().slice(0, 120) : undefined
  const senderIdentityId = Number.isInteger(doc.senderIdentityId) && Number(doc.senderIdentityId) > 0 ? Number(doc.senderIdentityId) : undefined
  const allowedOrigins = Array.isArray(doc.allowedOrigins)
    ? [...new Set(doc.allowedOrigins.map(normalizeOrigin).filter((origin): origin is string => !!origin))]
    : []

  return { listName, senderIdentityId, successUrl: httpUrl(doc.successUrl), allowedOrigins }
}

/** Whether a browser on `origin` may call the form. No Origin header is a server, or a plain form post. */
export function originAllowed(settings: FormSettings, origin: string | null | undefined): boolean {
  if (!origin || settings.allowedOrigins.length === 0)
    return true
  const normalized = normalizeOrigin(origin)
  return !!normalized && settings.allowedOrigins.includes(normalized)
}

/** Whether a request is a plain HTML form post, which wants a page back rather than JSON. */
export function wantsHtml(accept: string | null | undefined): boolean {
  const value = String(accept || '').toLowerCase()
  return value.includes('text/html') && !value.includes('application/json')
}
