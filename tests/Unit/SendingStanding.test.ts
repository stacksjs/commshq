import { describe, expect, test } from 'bun:test'
import { dailyCap, healthProblem, messageProblem } from '../../app/Hq/standing'

const NOW = new Date('2026-11-16T12:00:00.000Z')
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString()

describe('how much a sender may send in a day', () => {
  test('from CommsHQ\'s shared address the cap is low, however long the app has sent', () => {
    expect(dailyCap({ ownDomain: false, firstSentAt: null, now: NOW })).toBe(200)
    expect(dailyCap({ ownDomain: false, firstSentAt: daysAgo(400), now: NOW })).toBe(200)
  })

  test('a verified domain starts modest and earns volume over its first month', () => {
    const cap = (days: number | null): number => dailyCap({ ownDomain: true, firstSentAt: days === null ? null : daysAgo(days), now: NOW })
    expect(cap(null)).toBe(500)
    expect(cap(1)).toBe(500)
    expect(cap(4)).toBe(2_000)
    expect(cap(10)).toBe(10_000)
    expect(cap(20)).toBe(50_000)
    expect(cap(31)).toBe(Number.POSITIVE_INFINITY)
  })

  test('a date that cannot be read is a sender on its first day', () => {
    expect(dailyCap({ ownDomain: true, firstSentAt: 'not a date', now: NOW })).toBe(500)
  })
})

describe('when the numbers say stop', () => {
  test('a little mail is never judged by its rate', () => {
    expect(healthProblem({ sentLastWeek: 20, bouncesLastWeek: 10, complaintsLastWeek: 5 })).toBeNull()
  })

  test('mail that lands is left alone', () => {
    expect(healthProblem({ sentLastWeek: 5_000, bouncesLastWeek: 40, complaintsLastWeek: 2 })).toBeNull()
  })

  test('too many bounces pause the app, and say how many', () => {
    expect(healthProblem({ sentLastWeek: 1_000, bouncesLastWeek: 80, complaintsLastWeek: 0 })).toContain('80 of the last 1000 recipients bounced')
  })

  test('too many complaints pause it, but never one or two', () => {
    expect(healthProblem({ sentLastWeek: 1_000, bouncesLastWeek: 0, complaintsLastWeek: 5 })).toContain('marked the mail as spam')
    expect(healthProblem({ sentLastWeek: 200, bouncesLastWeek: 0, complaintsLastWeek: 2 })).toBeNull()
  })
})

describe('a message built the way a phishing message is built', () => {
  const ok = { fromName: 'Votescape', ownDomain: 'votescape.org' }

  test('an ordinary message passes', () => {
    expect(messageProblem({ ...ok, html: '<p>Results are in. <a href="https://votescape.org/2026">See the map</a> or visit <a href="https://www.votescape.org">votescape.org</a>.</p>', text: 'Results are in.' })).toBeNull()
    expect(messageProblem({ ...ok, text: 'Plain text only, with https://example.com in it.' })).toBeNull()
    expect(messageProblem({ ...ok, html: '<a href="https://en.wikipedia.org/wiki/2024_United_States_presidential_election">Read about the race</a>' })).toBeNull()
  })

  test('a sender name that is an address, or somebody else\'s site, is refused', () => {
    expect(messageProblem({ ...ok, fromName: 'security@bank.example' })).toContain('email address')
    expect(messageProblem({ ...ok, fromName: 'paypal.com Support' })).toContain('web address')
    // Its own site as a name is its own to use, but only once the domain is verified.
    expect(messageProblem({ ...ok, fromName: 'votescape.org' })).toBeNull()
    expect(messageProblem({ fromName: 'votescape.org', ownDomain: null })).toContain('web address')
    expect(messageProblem({ ...ok, fromName: 'Dr. Smith & Co.' })).toBeNull()
  })

  test('a link that reads as one site and opens another is refused', () => {
    expect(messageProblem({ ...ok, html: '<a href="https://evil.example/login">https://www.paypal.com/signin</a>' })).toContain('shown as paypal.com leads to evil.example')
    expect(messageProblem({ ...ok, html: '<a href=\'http://evil.example\'><b>bank.example</b></a>' })).toContain('leads to evil.example')
    // The same site, or a host beneath it, is not a lie.
    expect(messageProblem({ ...ok, html: '<a href="https://click.votescape.org/r/abc">votescape.org/results</a>' })).toBeNull()
  })

  test('a link that runs script, a form, a password field, a script or a frame is refused', () => {
    expect(messageProblem({ ...ok, html: '<a href="javascript:alert(1)">Open</a>' })).toContain('run script')
    expect(messageProblem({ ...ok, html: '<a href="data:text/html;base64,AAAA">Open</a>' })).toContain('run script')
    expect(messageProblem({ ...ok, html: '<FORM action="https://evil.example"><input name="user"></FORM>' })).toContain('form')
    expect(messageProblem({ ...ok, html: '<input type="password" name="p">' })).toContain('password')
    expect(messageProblem({ ...ok, html: '<script>fetch("https://evil.example")</script>' })).toContain('scripts')
    expect(messageProblem({ ...ok, html: '<iframe src="https://evil.example"></iframe>' })).toContain('scripts')
  })
})
