/**
 * Whether an app's mail should go out: the rules that keep CommsHQ's
 * addresses worth sending from.
 *
 * Every app that sends through CommsHQ shares its reputation. Mailbox
 * providers judge the addresses the mail leaves from, so one app that sends
 * a scam, or mail nobody asked for, costs every other app its inbox
 * placement. What is here is decided before a message is handed over:
 *
 *   - a new sender starts small and earns volume by sending mail that lands;
 *   - an app whose mail bounces or draws complaints is paused, by the
 *     numbers, until a person has looked;
 *   - a message that is built the way a phishing message is built is refused;
 *   - one address cannot be flooded.
 *
 * All of it is pure: the store supplies the counts, and `sendForApp` asks.
 */

export interface SendingCounts {
  /** Why the app's sending is paused, or null when it is not. */
  pausedReason: string | null
  /** Recipients the workspace's apps sent to in the last 24 hours. */
  sentLastDay: number
  /** Recipients the workspace's apps sent to in the last 7 days. */
  sentLastWeek: number
  /** Addresses that hard-bounced in the last 7 days. */
  bouncesLastWeek: number
  /** Recipients who marked mail as spam in the last 7 days. */
  complaintsLastWeek: number
  /** When the workspace's apps first sent, ISO, or null if never. */
  firstSentAt: string | null
}

const DAY = 86_400_000

/**
 * How many recipients a workspace's apps may reach in 24 hours.
 *
 * From CommsHQ's shared address the cap is low and stays low: that address
 * carries everybody's reputation and no domain of the sender's own stands
 * behind the mail. From a domain the app verified, the cap starts modest and
 * steps up as the sender ages, the way a mailbox provider expects volume from
 * a new domain to grow. After a month only the plan's allowance applies.
 */
export function dailyCap(input: { ownDomain: boolean, firstSentAt: string | null, now: Date }): number {
  if (!input.ownDomain)
    return 200
  const first = input.firstSentAt ? Date.parse(input.firstSentAt) : Number.NaN
  const age = Number.isFinite(first) ? Math.max(0, input.now.getTime() - first) : 0
  if (age < 3 * DAY)
    return 500
  if (age < 7 * DAY)
    return 2_000
  if (age < 14 * DAY)
    return 10_000
  if (age < 30 * DAY)
    return 50_000
  return Number.POSITIVE_INFINITY
}

/** Bounces above this share of a week's mail mean the list was not collected honestly. */
export const MAX_BOUNCE_RATE = 0.05
/** Complaints above this share are where mailbox providers start filing a sender as spam. */
export const MAX_COMPLAINT_RATE = 0.003
/** Below this much mail a rate is noise: two bounces out of ten is not a pattern. */
const MIN_SAMPLE = 100

/**
 * Why an app's sending should stop until a person has looked, or null.
 *
 * Judged on the week, and only once there is enough mail for a rate to mean
 * something. The thresholds are the ones mailbox providers publish for bulk
 * senders: past them the damage is to every sender on the address.
 */
export function healthProblem(counts: Pick<SendingCounts, 'sentLastWeek' | 'bouncesLastWeek' | 'complaintsLastWeek'>): string | null {
  const sent = counts.sentLastWeek
  if (sent < MIN_SAMPLE)
    return null
  if (counts.bouncesLastWeek / sent > MAX_BOUNCE_RATE)
    return `${counts.bouncesLastWeek} of the last ${sent} recipients bounced, more than ${MAX_BOUNCE_RATE * 100}%`
  if (counts.complaintsLastWeek >= 3 && counts.complaintsLastWeek / sent > MAX_COMPLAINT_RATE)
    return `${counts.complaintsLastWeek} of the last ${sent} recipients marked the mail as spam, more than ${MAX_COMPLAINT_RATE * 100}%`
  return null
}

/** The host of a URL, lower-cased without `www.`, or undefined when it is not one. */
function hostOf(value: string): string | undefined {
  const text = value.trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]|$)/i.test(text))
    return undefined
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    return url.hostname.toLowerCase().replace(/^www\./, '') || undefined
  }
  catch {
    return undefined
  }
}

/** Whether two hosts are the same site: equal, or one beneath the other. */
function sameSite(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

function plain(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim()
}

export interface MessageToScreen {
  /** The display name the mail goes out under. */
  fromName: string
  /** The domain the app verified, or null when it sends from CommsHQ's address. */
  ownDomain: string | null
  html?: string
  text?: string
}

/**
 * Why a message is refused for how it is built, or null.
 *
 * These are the constructions a phishing message depends on and an honest
 * one has no use for. Each is about the message's shape, never its topic:
 * nothing here guesses at intent from words.
 *
 *   - A sender name that is itself an address or a web address. A reader
 *     sees the name before the address, so "support@bank.example" as a name
 *     borrows an identity the sender does not have.
 *   - A link that reads as one site and leads to another.
 *   - A link that runs script or carries a page inside it.
 *   - A form, or a password field: mail that collects credentials in place.
 */
export function messageProblem(message: MessageToScreen): string | null {
  const name = message.fromName
  if (/@/.test(name))
    return 'The sender name may not contain an email address'
  const nameHost = name.split(/\s+/).map(hostOf).find(Boolean)
  if (nameHost && !(message.ownDomain && sameSite(nameHost, message.ownDomain)))
    return 'The sender name may not be a web address other than your own domain'

  const html = message.html ?? ''
  if (!html)
    return null
  if (/<\s*form\b/i.test(html) || /<\s*input\b[^>]*type\s*=\s*["']?password/i.test(html))
    return 'A message may not contain a form or a password field: link to a page on your site instead'
  if (/<\s*(?:script|iframe|object|embed)\b/i.test(html))
    return 'A message may not contain scripts or embedded pages'

  const anchors = html.matchAll(/<\s*a\b([^>]*)>([\s\S]*?)<\s*\/\s*a\s*>/gi)
  for (const anchor of anchors) {
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(anchor[1] ?? '')
    const target = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim()
    if (/^(?:javascript|data|vbscript):/i.test(target))
      return 'A link may not run script or carry its own page'
    const shown = hostOf(plain(anchor[2] ?? ''))
    const actual = hostOf(target)
    // Only a link whose text is itself a web address can lie about where it
    // goes. "Read more" promises nothing.
    if (shown && actual && !sameSite(shown, actual))
      return `A link shown as ${shown} leads to ${actual}: a link's text may not name a different site than it opens`
  }
  return null
}

/** Messages one address may be sent by one app in an hour. */
export const MAX_PER_RECIPIENT_PER_HOUR = 20
