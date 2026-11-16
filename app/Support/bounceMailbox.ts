/**
 * What came back: delivery failures and spam complaints, read from the
 * mailbox they are returned to.
 *
 * Every message CommsHQ sends for an app carries CommsHQ's own address as its
 * envelope sender, so a failure anywhere along the way comes home to that
 * mailbox as a delivery status notification (RFC 3464), and a mailbox
 * provider's "this is spam" report as a feedback report (RFC 5965). Reading
 * them is what makes the bounce and complaint limits in `app/Hq/standing.ts`
 * mean something: without it nothing ever counts against a sender.
 *
 * Two halves. `parseReturnedMail` is pure and decides what a message says.
 * `readMailbox` is the small IMAP conversation that fetches the unread ones
 * and marks them read. It speaks only what it needs: LOGIN, SELECT, SEARCH,
 * FETCH, STORE.
 */

import * as tls from 'node:tls'

export interface ReturnedMail {
  kind: 'bounce' | 'complaint'
  /** The address the mail did not reach, or whose owner complained. Lower-cased. */
  recipient: string
  /** The enhanced status code of a bounce (`5.1.1`), when the report gave one. */
  status?: string
  /** What the remote server said. One line, bounded. */
  detail?: string
}

const ADDRESS = /[^\s<>"',;:]+@[^\s<>"',;:]+\.[a-z0-9-]+/i

function field(text: string, name: string): string | undefined {
  // A header field, with its folded continuation lines.
  const match = new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t]+.*)*)`, 'im').exec(text)
  return match?.[1]?.replace(/\r?\n[ \t]+/g, ' ').trim()
}

function addressIn(value: string | undefined): string | undefined {
  const found = value ? ADDRESS.exec(value) : null
  return found ? found[0].toLowerCase().replace(/[.>]+$/, '') : undefined
}

/**
 * What a returned message says, or null when it is neither a permanent
 * failure nor a complaint.
 *
 * Only what the report states in its machine-readable part is believed. A
 * temporary failure (`4.x.x`, "delayed") is not a bounce: the message may
 * still arrive, and an address is suppressed only when it cannot. A message
 * that merely looks like a bounce to a person, an out-of-office reply or a
 * human answer, has no delivery-status part and is ignored.
 */
export function parseReturnedMail(raw: string): ReturnedMail | null {
  const split = raw.search(/\r?\n\r?\n/)
  const headers = split === -1 ? raw : raw.slice(0, split)
  const contentType = field(headers, 'Content-Type') ?? ''

  if (/report-type\s*=\s*"?feedback-report/i.test(contentType) || /^Feedback-Type:/im.test(raw)) {
    const type = field(raw, 'Feedback-Type') ?? 'abuse'
    // "This is not spam" is a report too, and the opposite of a complaint.
    if (/not-spam/i.test(type))
      return null
    const recipient = addressIn(field(raw, 'Original-Rcpt-To')) ?? addressIn(field(raw, 'Removal-Recipient'))
    return recipient ? { kind: 'complaint', recipient, detail: type.slice(0, 80) } : null
  }

  if (!/report-type\s*=\s*"?delivery-status/i.test(contentType) && !/^Final-Recipient:/im.test(raw))
    return null
  const action = (field(raw, 'Action') ?? '').toLowerCase()
  const status = /\b([245]\.\d{1,3}\.\d{1,3})\b/.exec(field(raw, 'Status') ?? '')?.[1]
  // Permanent only: the report says it failed, and not with a 4.x.x that a
  // retry may still get past.
  if (action !== 'failed' || (status && !status.startsWith('5.')))
    return null
  const recipient = addressIn(field(raw, 'Final-Recipient')) ?? addressIn(field(raw, 'Original-Recipient'))
  if (!recipient)
    return null
  const detail = field(raw, 'Diagnostic-Code')?.replace(/^smtp;\s*/i, '').slice(0, 300)
  return { kind: 'bounce', recipient, status, detail }
}

export interface MailboxOptions {
  host: string
  port?: number
  username: string
  password: string
  /** Most messages to read in one pass. The rest wait for the next. */
  limit?: number
  timeoutMs?: number
  /** For tests: the connection to talk over instead of TLS to `host`. */
  connect?: () => MailSocket
}

export interface MailSocket {
  write: (data: string) => unknown
  on: (event: 'data' | 'error' | 'close', listener: (value: any) => void) => unknown
  end: () => unknown
  destroy?: () => unknown
}

function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

/**
 * Read the unread messages of a mailbox's INBOX, hand each to `handle`, and
 * mark as read the ones it returns true for.
 *
 * A message `handle` throws on, or returns false for, stays unread and is
 * offered again on the next pass, so a failure to record a bounce is never a
 * bounce lost. Returns how many were read and how many were marked.
 */
export async function readMailbox(options: MailboxOptions, handle: (raw: string) => Promise<boolean>): Promise<{ read: number, marked: number }> {
  const socket: MailSocket = options.connect?.() ?? tls.connect({ host: options.host, port: options.port ?? 993, servername: options.host })
  const timeoutMs = options.timeoutMs ?? 30_000
  let buffer = ''
  let failed: Error | null = null
  let wake: (() => void) | null = null
  socket.on('data', (chunk: unknown) => {
    buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('latin1')
    wake?.()
  })
  socket.on('error', (error: Error) => {
    failed = error
    wake?.()
  })
  socket.on('close', () => {
    failed ??= new Error('The mail server closed the connection')
    wake?.()
  })

  const until = async (done: () => boolean): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (!done()) {
      if (failed)
        throw failed
      const left = deadline - Date.now()
      if (left <= 0)
        throw new Error('The mail server did not answer in time')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(left, 1000))
        wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      wake = null
    }
  }

  let counter = 0
  /** Send one command and return everything up to its tagged completion. */
  const command = async (text: string): Promise<string> => {
    const tag = `c${++counter}`
    socket.write(`${tag} ${text}\r\n`)
    const completion = new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`, 'g')
    // A fetched message is a literal, `{n}` then n bytes, and those bytes are
    // somebody else's words: a line in them that reads like this command's
    // completion is not one. The completion is looked for after the literal.
    const find = (): RegExpExecArray | null => {
      const literal = /\{(\d+)\}\r\n/.exec(buffer)
      const after = literal ? literal.index + literal[0].length + Number(literal[1]) : 0
      if (after > buffer.length)
        return null
      completion.lastIndex = Math.max(0, after - 2)
      return completion.exec(buffer)
    }
    await until(() => find() !== null)
    const match = find()!
    const end = match.index + match[0].length
    const answer = buffer.slice(0, end)
    buffer = buffer.slice(end)
    if (match[1] !== 'OK')
      throw new Error(`The mail server refused ${text.split(' ')[0]}`)
    return answer
  }

  try {
    await until(() => /^\* (?:OK|PREAUTH)[^\r\n]*\r\n/.test(buffer))
    buffer = buffer.replace(/^\*[^\r\n]*\r\n/, '')
    await command(`LOGIN ${quoted(options.username)} ${quoted(options.password)}`)
    await command('SELECT INBOX')
    const found = /\* SEARCH([^\r\n]*)/.exec(await command('UID SEARCH UNSEEN'))?.[1] ?? ''
    const uids = found.trim().split(/\s+/).filter(uid => /^\d+$/.test(uid)).slice(0, options.limit ?? 200)

    let marked = 0
    for (const uid of uids) {
      const answer = await command(`UID FETCH ${uid} (BODY.PEEK[])`)
      // The body is a literal: `{n}` then exactly n bytes, which is why the
      // connection is read as latin1, one character to a byte.
      const literal = /\{(\d+)\}\r\n/.exec(answer)
      if (!literal)
        continue
      const start = literal.index + literal[0].length
      const raw = Buffer.from(answer.slice(start, start + Number(literal[1])), 'latin1').toString('utf8')
      const done = await handle(raw).catch(() => false)
      if (done) {
        await command(`UID STORE ${uid} +FLAGS.SILENT (\\Seen)`)
        marked++
      }
    }
    await command('LOGOUT').catch(() => {})
    return { read: uids.length, marked }
  }
  finally {
    socket.end()
    socket.destroy?.()
  }
}
