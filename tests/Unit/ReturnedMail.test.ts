import { describe, expect, test } from 'bun:test'
import { parseReturnedMail, readMailbox } from '../../app/Support/bounceMailbox'
import { noSuchRecipient } from '../../app/Jobs/SendAppMail'

const lines = (...parts: string[]): string => parts.join('\r\n')

/** A delivery status notification as the mail server writes it. */
function dsn(over: { status?: string, action?: string, recipient?: string } = {}): string {
  return lines(
    'From: Mail Delivery System <mailer-daemon@mail.stacksjs.com>',
    'To: no-reply@commshq.org',
    'Subject: Mail delivery failed: returning message to sender',
    'Auto-Submitted: auto-replied',
    'MIME-Version: 1.0',
    'Content-Type: multipart/report; report-type=delivery-status; boundary="=_Bounce_1_0"',
    '',
    '--=_Bounce_1_0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Failed recipient: someone@elsewhere.example',
    '',
    '--=_Bounce_1_0',
    'Content-Type: message/delivery-status',
    '',
    'Reporting-MTA: dns; mail.stacksjs.com',
    '',
    `Final-Recipient: rfc822; ${over.recipient ?? 'Gone@Example.com'}`,
    `Action: ${over.action ?? 'failed'}`,
    `Status: ${over.status ?? '5.1.1'}`,
    'Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach',
    ' does not exist',
    '',
    '--=_Bounce_1_0--',
  )
}

describe('what a returned message says', () => {
  test('a permanent failure is a bounce, for the address the report names', () => {
    expect(parseReturnedMail(dsn())).toEqual({ kind: 'bounce', recipient: 'gone@example.com', status: '5.1.1', detail: '550 5.1.1 The email account that you tried to reach does not exist' })
    expect(parseReturnedMail(dsn({ status: '5.0.0', recipient: '<gone@example.com>' }))?.recipient).toBe('gone@example.com')
  })

  test('a delay or a temporary failure is not: the message may still arrive', () => {
    expect(parseReturnedMail(dsn({ action: 'delayed', status: '4.4.1' }))).toBeNull()
    expect(parseReturnedMail(dsn({ status: '4.2.2' }))).toBeNull()
    expect(parseReturnedMail(dsn({ action: 'delivered', status: '2.0.0' }))).toBeNull()
  })

  test('a spam report is a complaint from the address it was sent to', () => {
    const report = lines(
      'From: feedback@provider.example',
      'Content-Type: multipart/report; report-type=feedback-report; boundary="b"',
      '',
      '--b',
      'Content-Type: message/feedback-report',
      '',
      'Feedback-Type: abuse',
      'User-Agent: Provider/1.0',
      'Original-Rcpt-To: <Reader@Example.com>',
      '',
      '--b--',
    )
    expect(parseReturnedMail(report)).toEqual({ kind: 'complaint', recipient: 'reader@example.com', detail: 'abuse' })
    expect(parseReturnedMail(report.replace('Feedback-Type: abuse', 'Feedback-Type: not-spam'))).toBeNull()
  })

  test('an auto-reply, or a person writing back, is neither', () => {
    expect(parseReturnedMail(lines('From: reader@example.com', 'Subject: Out of office', 'Content-Type: text/plain', '', 'I am away. The delivery failed? No: Action: failed is just words here.'))).toBeNull()
    expect(parseReturnedMail('')).toBeNull()
  })
})

/** A mail server that answers the few commands the reader sends. */
function fakeServer(messages: Record<string, string>, options: { refuseLogin?: boolean } = {}) {
  const listeners: Record<string, Array<(value: any) => void>> = {}
  const seen: string[] = []
  const commands: string[] = []
  const emit = (text: string): void => { queueMicrotask(() => listeners.data?.forEach(listener => listener(Buffer.from(text, 'latin1')))) }
  const socket = {
    on(event: string, listener: (value: any) => void) {
      ;(listeners[event] ??= []).push(listener)
      if (event === 'data')
        emit('* OK ready\r\n')
    },
    write(data: string) {
      const [tag, ...rest] = data.trim().split(' ')
      const text = rest.join(' ')
      commands.push(text.startsWith('LOGIN') ? 'LOGIN' : text)
      if (text.startsWith('LOGIN'))
        return emit(options.refuseLogin ? `${tag} NO bad credentials\r\n` : `${tag} OK\r\n`)
      if (text === 'UID SEARCH UNSEEN')
        return emit(`* SEARCH ${Object.keys(messages).filter(uid => !seen.includes(uid)).join(' ')}\r\n${tag} OK\r\n`)
      const fetch = /^UID FETCH (\d+)/.exec(text)
      if (fetch) {
        const body = Buffer.from(messages[fetch[1]!]!, 'utf8').toString('latin1')
        return emit(`* 1 FETCH (UID ${fetch[1]} BODY[] {${body.length}}\r\n${body})\r\n${tag} OK\r\n`)
      }
      const store = /^UID STORE (\d+)/.exec(text)
      if (store)
        seen.push(store[1]!)
      emit(`${tag} OK\r\n`)
    },
    end() {},
  }
  return { socket, seen, commands }
}

describe('reading the return mailbox', () => {
  const options = { host: 'mail.test', username: 'no-reply@commshq.test', password: 'p"w\\d', timeoutMs: 2000 }

  test('each unread message is handed over whole, and marked read once it is dealt with', async () => {
    // A body with a line that looks like a completion, and one with a character beyond ASCII.
    const server = fakeServer({ 7: dsn(), 9: 'Subject: Résumé\r\n\r\nc6 OK not the end\r\nc6 NO nor this\r\n' })
    const got: string[] = []
    const result = await readMailbox({ ...options, connect: () => server.socket }, async (raw) => {
      got.push(raw)
      return true
    })
    expect(result).toEqual({ read: 2, marked: 2 })
    expect(got[0]).toBe(dsn())
    expect(got[1]).toBe('Subject: Résumé\r\n\r\nc6 OK not the end\r\nc6 NO nor this\r\n')
    expect(server.seen).toEqual(['7', '9'])
  })

  test('a message that could not be dealt with stays unread for the next pass', async () => {
    const server = fakeServer({ 7: dsn(), 9: dsn() })
    let calls = 0
    const result = await readMailbox({ ...options, connect: () => server.socket }, async () => {
      if (++calls === 1)
        throw new Error('database away')
      return true
    })
    expect(result).toEqual({ read: 2, marked: 1 })
    expect(server.seen).toEqual(['9'])
  })

  test('an empty mailbox fetches nothing, and a refused sign-in is an error', async () => {
    const empty = fakeServer({})
    expect(await readMailbox({ ...options, connect: () => empty.socket }, async () => true)).toEqual({ read: 0, marked: 0 })
    expect(empty.commands.some(command => command.startsWith('UID FETCH'))).toBe(false)

    const locked = fakeServer({}, { refuseLogin: true })
    await expect(readMailbox({ ...options, connect: () => locked.socket }, async () => true)).rejects.toThrow('refused LOGIN')
  })
})

describe('a refusal that no retry can change', () => {
  test('is one about the address itself, and nothing else', () => {
    expect(noSuchRecipient('Email sending failed: SMTP Error: 550 5.1.1 Recipient address rejected: user unknown')).toBe(true)
    expect(noSuchRecipient('SMTP Error: 550-5.1.1 no such user')).toBe(true)
    expect(noSuchRecipient('SMTP Error: 550 5.7.1 Message author is not authorized for this account')).toBe(false)
    expect(noSuchRecipient('SMTP Error: 451 4.3.0 try again later')).toBe(false)
    expect(noSuchRecipient('connect ECONNREFUSED')).toBe(false)
    expect(noSuchRecipient(undefined)).toBe(false)
  })
})
