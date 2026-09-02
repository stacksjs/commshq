import type { SubscribeFields } from '../../resources/functions/client'
import { describe, expect, it } from 'bun:test'
import { CommsHqError, createClient } from '../../resources/functions/client'
import { readFormFields } from '../../resources/functions/forms'

/**
 * `commshq-fx` is the only code we ship that runs in somebody else's page, and
 * the things it has to get right are the ones a page cannot recover from: a
 * 202 that means "check your email" read as a failure, a preference centre
 * that silently opts somebody out of a channel its form never mentioned, or a
 * dropped connection reported to a visitor as a rejected address.
 */

/** A `fetch` that answers with what the real endpoints answer with. */
function stubFetch(replies: Array<{ status?: number, body?: unknown, contentType?: string }>) {
  const calls: Array<{ url: string, init: RequestInit }> = []
  let index = 0

  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const reply = replies[Math.min(index++, replies.length - 1)] ?? {}

    return new Response(
      reply.body === undefined ? '' : JSON.stringify(reply.body),
      {
        status: reply.status ?? 200,
        headers: { 'content-type': reply.contentType ?? 'application/json' },
      },
    )
  }) as unknown as typeof globalThis.fetch

  return { fetcher, calls }
}

function bodyOf(init: RequestInit): any {
  return JSON.parse(String(init.body))
}

describe('signing up', () => {
  it('reports that a confirmation is on its way', async () => {
    const { fetcher, calls } = stubFetch([{ status: 202, body: { accepted: true, confirmationRequired: true } }])
    const client = createClient({ baseUrl: 'https://commshq.org/', fetch: fetcher })

    const result = await client.subscribe('form-abc', { email: ' Rosa@Example.com ', firstName: 'Rosa' })

    // A 202 is the success case for a double opt-in form, not a failure, and
    // it is the only thing that tells the page which thank-you to show.
    expect(result).toEqual({ accepted: true, confirmationRequired: true })
    expect(calls[0]!.url).toBe('https://commshq.org/forms/form-abc/submit')
    expect(bodyOf(calls[0]!.init)).toMatchObject({ email: 'Rosa@Example.com', firstName: 'Rosa' })
  })

  it('says so when the form takes the signup outright', async () => {
    const { fetcher } = stubFetch([{ status: 202, body: { accepted: true, confirmationRequired: false } }])
    const client = createClient({ fetch: fetcher })

    expect(await client.subscribe('form-abc', { email: 'rosa@example.com' })).toMatchObject({ confirmationRequired: false })
  })

  it('does not spend an attempt on an empty address', async () => {
    const { fetcher, calls } = stubFetch([{ status: 202, body: { accepted: true } }])
    const client = createClient({ fetch: fetcher })

    // The endpoint allows twenty attempts a minute and answers 422 for this.
    // Spending one to be told the field was blank is a round trip nobody gets back.
    await expect(client.subscribe('form-abc', { email: '   ' } as SubscribeFields)).rejects.toThrow(CommsHqError)
    expect(calls).toHaveLength(0)
  })

  it('keeps the words the API used, and the status with them', async () => {
    const { fetcher } = stubFetch([{ status: 404, body: { error: 'Form not found' } }])
    const client = createClient({ fetch: fetcher })

    const error = await client.subscribe('gone', { email: 'rosa@example.com' }).catch((caught: CommsHqError) => caught)

    expect(error).toBeInstanceOf(CommsHqError)
    expect((error as CommsHqError).message).toBe('Form not found')
    expect((error as CommsHqError).isExpiredLink).toBe(true)
    expect((error as CommsHqError).isRateLimited).toBe(false)
  })

  it('marks a rate limit as the one worth retrying', async () => {
    const { fetcher } = stubFetch([{ status: 429, body: { error: 'Please wait before trying again' } }])
    const client = createClient({ fetch: fetcher })

    const error = await client.subscribe('form-abc', { email: 'rosa@example.com' }).catch((caught: CommsHqError) => caught)

    expect((error as CommsHqError).isRateLimited).toBe(true)
  })

  it('does not blame the visitor for a dropped connection', async () => {
    const fetcher = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof globalThis.fetch
    const client = createClient({ fetch: fetcher })

    const error = await client.subscribe('form-abc', { email: 'rosa@example.com' }).catch((caught: CommsHqError) => caught)

    // Status 0 means "never arrived". Reported as a 422 the page would tell
    // somebody their own address was rejected, which is false.
    expect((error as CommsHqError).status).toBe(0)
    expect((error as CommsHqError).isInvalidInput).toBe(false)
  })
})

describe('the preference centre', () => {
  it('sends the words the endpoint actually parses', async () => {
    const { fetcher, calls } = stubFetch([{ body: { updated: true, emailConfirmationRequired: true, smsStartRequired: false } }])
    const client = createClient({ fetch: fetcher })

    const result = await client.updatePreferences('tok', { email: true, sms: false })

    // `parsePreferenceChoice` reads these strings; anything it does not
    // recognise means "leave this channel alone".
    expect(bodyOf(calls[0]!.init)).toEqual({ email: 'enabled', sms: 'disabled' })
    expect(result).toEqual({ updated: true, emailConfirmationRequired: true, smsStartRequired: false })
  })

  it('leaves out a channel the caller said nothing about', async () => {
    const { fetcher, calls } = stubFetch([{ body: { updated: true } }])
    const client = createClient({ fetch: fetcher })

    await client.updatePreferences('tok', { email: false })

    // A form that only shows email must not opt somebody out of SMS. Sending
    // `sms: 'disabled'` here would do exactly that, silently.
    expect(bodyOf(calls[0]!.init)).toEqual({ email: 'disabled' })
  })

  it('reads back a contact and both channels', async () => {
    const { fetcher } = stubFetch([{
      body: { contact: { email: 'rosa@example.com', phone: '' }, channels: { email: { status: 'subscribed' }, sms: {} } },
    }])
    const client = createClient({ fetch: fetcher })

    expect(await client.preferences('tok')).toMatchObject({
      contact: { email: 'rosa@example.com' },
      channels: { email: { status: 'subscribed' } },
    })
  })

  it('refuses an empty token rather than addressing /preferences/', async () => {
    const { fetcher, calls } = stubFetch([{ body: {} }])
    const client = createClient({ fetch: fetcher })

    await expect(client.preferences('')).rejects.toThrow(CommsHqError)
    expect(calls).toHaveLength(0)
  })

  it('encodes a token rather than letting it change the path', async () => {
    const { fetcher, calls } = stubFetch([{ body: { unsubscribed: true } }])
    const client = createClient({ baseUrl: 'https://commshq.org', fetch: fetcher })

    await client.unsubscribe('../admin/delete')

    // A token arrives from an email link and goes into a path segment. Left
    // raw, this one addresses a different endpoint than the function names.
    expect(calls[0]!.url).toBe('https://commshq.org/unsubscribe/..%2Fadmin%2Fdelete')
  })

  it('names the confirmation URL without following it', () => {
    const client = createClient({ baseUrl: 'https://commshq.org/' })

    // The endpoint answers with a redirect, so this is a link to put in a
    // page, not something to fetch and read.
    expect(client.confirmUrl('tok-123')).toBe('https://commshq.org/confirm/tok-123')
  })
})

describe('reading a form', () => {
  it('accepts the field names a hand-written form actually uses', () => {
    const original = globalThis.FormData

    class StubFormData {
      constructor(private readonly pairs: Array<[string, string]>) {}
      entries() { return this.pairs[Symbol.iterator]() }
    }

    // eslint-disable-next-line ts/no-unsafe-function-type
    globalThis.FormData = (function (this: any, form: any) {
      return new StubFormData(form.pairs)
    }) as any

    try {
      const fields = readFormFields({ pairs: [['EMAIL', ' rosa@example.com '], ['firstName', 'Rosa']] } as any)

      // Mailchimp-shaped markup names it EMAIL. A library that only reads
      // `email` posts a blank address and blames the visitor for it.
      expect(fields.email).toBe('rosa@example.com')
      expect(fields.firstName).toBe('Rosa')
    }
    finally {
      globalThis.FormData = original
    }
  })
})
