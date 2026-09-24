import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { originAllowed, parseFormSettings, wantsHtml } from '../../app/Actions/Public/form-settings'
import { createPublicToken, verifyPublicToken } from '../../app/Actions/Public/signed-token'
import { buildConfirmationMessage } from '../../app/Mail/ConfirmSubscription'

describe('form settings', () => {
  it('reads the list, sender, landing page and origins from the schema document', () => {
    const settings = parseFormSettings(JSON.stringify({
      fields: [{ name: 'email' }],
      listName: '  Chris Breuer ',
      senderIdentityId: 3,
      successUrl: 'https://chrisbreuer.me/?subscribed=1',
      allowedOrigins: ['https://chrisbreuer.me/', 'https://www.chrisbreuer.me', 'not a url', 'javascript:alert(1)'],
    }))
    expect(settings).toEqual({
      listName: 'Chris Breuer',
      senderIdentityId: 3,
      successUrl: 'https://chrisbreuer.me/?subscribed=1',
      allowedOrigins: ['https://chrisbreuer.me', 'https://www.chrisbreuer.me'],
    })
  })

  it('treats a missing or malformed document as a plain form', () => {
    for (const doc of [undefined, '', 'not json', '[1,2]', { successUrl: 'javascript:alert(1)', senderIdentityId: 'x' }])
      expect(parseFormSettings(doc)).toEqual({ listName: undefined, senderIdentityId: undefined, successUrl: undefined, allowedOrigins: [] })
  })

  it('lets any site post when the form names none, and only those it names otherwise', () => {
    const open = parseFormSettings({})
    const closed = parseFormSettings({ allowedOrigins: ['https://chrisbreuer.me'] })
    expect(originAllowed(open, 'https://anywhere.example')).toBe(true)
    expect(originAllowed(closed, 'https://chrisbreuer.me')).toBe(true)
    expect(originAllowed(closed, 'https://evil.example')).toBe(false)
    // No Origin: a server, or a plain form post, which CORS does not govern.
    expect(originAllowed(closed, null)).toBe(true)
  })

  it('tells a plain form post from a script', () => {
    expect(wantsHtml('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(true)
    expect(wantsHtml('application/json')).toBe(false)
    expect(wantsHtml('*/*')).toBe(false)
  })
})

describe('confirmation email', () => {
  it('comes from the list when the form names one', () => {
    const message = buildConfirmationMessage('reader@example.com', 'https://commshq.org/confirm/t', {
      listName: 'Chris Breuer',
      from: { name: 'Chris Breuer', address: 'hi@chrisbreuer.me' },
      replyTo: 'hi@chrisbreuer.me',
    })
    expect(message.subject).toBe('Confirm your subscription to Chris Breuer')
    expect(message.from).toEqual({ name: 'Chris Breuer', address: 'hi@chrisbreuer.me' })
    expect(message.replyTo).toBe('hi@chrisbreuer.me')
    expect(message.text).toContain('https://commshq.org/confirm/t')
    expect(message.html).toContain('href="https://commshq.org/confirm/t"')
  })

  it('escapes a list name before it reaches the HTML', () => {
    const message = buildConfirmationMessage('r@example.com', 'https://x/confirm/t', { listName: '<b>Lists</b>' })
    expect(message.html).not.toContain('<b>Lists</b>')
  })
})

describe('confirm links', () => {
  it('carry the form they came from', () => {
    const secret = 'test-signing-key'
    const payload = { teamId: 4, contactId: 9, channel: 'email' as const, purpose: 'confirm' as const, formId: 12, expiresAt: 2_000 }
    expect(verifyPublicToken(createPublicToken(payload, secret), secret, 1_000)).toEqual(payload)
    expect(verifyPublicToken(createPublicToken({ ...payload, formId: 1.5 } as any, secret), secret, 1_000)).toBeNull()
  })
})

describe('the public surface', () => {
  const routes = readFileSync(resolve(import.meta.dir, '../../routes/public.ts'), 'utf8')

  it('skips CSRF on every public POST, which has no CommsHQ session to pair with', () => {
    const posts = routes.split('\n').filter(line => line.startsWith('route.post('))
    expect(posts.length).toBeGreaterThan(0)
    for (const line of posts)
      expect(line).toContain('.skipCsrf()')
  })

  it('never unsubscribes on a GET, which link scanners fetch unasked', () => {
    const page = readFileSync(resolve(import.meta.dir, '../../app/Actions/Public/UnsubscribePageAction.ts'), 'utf8')
    expect(page).not.toContain('ensureSuppressed')
    expect(page).not.toContain('update(')
  })

  it('forwards the email links from the views server to the API', () => {
    const server = readFileSync(resolve(import.meta.dir, '../../config/server.ts'), 'utf8')
    for (const prefix of ['/confirm/', '/unsubscribe/', '/preferences/'])
      expect(server).toContain(`'${prefix}'`)
    expect(server).toContain(`'OPTIONS'`)
  })
})

describe('campaign unsubscribe', () => {
  it('adds a footer link and the one-click headers', async () => {
    const { withUnsubscribe } = await import('../../app/Mail/unsubscribe')
    const out = withUnsubscribe('<p>Hi</p>', 'Hi', 'https://commshq.org/unsubscribe/t?a=1&b=2')
    expect(out.html).toContain('href="https://commshq.org/unsubscribe/t?a=1&amp;b=2"')
    expect(out.text).toContain('Unsubscribe: https://commshq.org/unsubscribe/t?a=1&b=2')
    expect(out.headers).toEqual({
      'List-Unsubscribe': '<https://commshq.org/unsubscribe/t?a=1&b=2>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('fills {{unsubscribe_url}} where the template places it, every time', async () => {
    const { withUnsubscribe } = await import('../../app/Mail/unsubscribe')
    for (let i = 0; i < 2; i++) {
      const out = withUnsubscribe('<a href="{{ unsubscribe_url }}">Leave</a>', 'Leave: {{unsubscribe_url}}', 'https://x/u')
      expect(out.html).toBe('<a href="https://x/u">Leave</a>')
      expect(out.text).toBe('Leave: https://x/u')
    }
  })
})
