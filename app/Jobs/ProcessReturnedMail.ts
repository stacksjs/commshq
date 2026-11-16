import process from 'node:process'
import { config } from '@stacksjs/config'
import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { parseReturnedMail, readMailbox } from '../Support/bounceMailbox'
import { ensureSuppressed } from '../Support/consentLedger'
import { sqlRun } from '../Support/sqlRun'

/** How far back a send is looked for when a failure comes home. Late bounces arrive days after. */
const LOOKBACK_MS = 14 * 86_400_000

/** The workspaces whose apps wrote to an address lately: the ones its bounce belongs to. */
export async function teamsThatWroteTo(recipient: string, now: Date = new Date()): Promise<number[]> {
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString()
  // `recipients` is a JSON list of lower-cased addresses, so a quoted match
  // is exact. `!` escapes the address's own `_` and `%`. The backslashes are
  // dropped first for rows written before JSON was cast on its way into
  // Postgres, which hold the list as a string with its quotes escaped.
  const needle = `%"${recipient.replace(/[!%_]/g, '!$&')}"%`
  const rows = await sqlRun('SELECT DISTINCT team_id FROM app_sends WHERE created_at >= ? AND status = ? AND REPLACE(CAST(recipients AS TEXT), ?, ?) LIKE ? ESCAPE ?', [since, 'sent', '\\', '', needle, '!'])
  return rows.map(row => Number(row.team_id)).filter(id => Number.isInteger(id) && id > 0)
}

export default new Job({
  name: 'ProcessReturnedMail', description: 'Reads bounces and spam complaints from the return mailbox and suppresses the addresses', queue: 'scheduler', tries: 1,
  async handle() {
    const username = String(process.env.MAIL_USERNAME || config.email?.from?.address || '')
    const local = username.split('@')[0]?.toUpperCase().replace(/[^A-Z0-9]/g, '_')
    const password = String(process.env.MAIL_PASSWORD || (local ? process.env[`MAIL_PASSWORD_${local}`] : '') || '')
    const host = String(process.env.MAIL_HOST || '')
    // Nowhere to read from: a developer's machine, or mail not set up yet.
    if (!username || !password || !host || ['127.0.0.1', 'localhost', 'mailpit'].includes(host))
      return { skipped: true }

    let bounces = 0
    let complaints = 0
    const result = await readMailbox({ host, username, password }, async (raw) => {
      const returned = parseReturnedMail(raw)
      // Not a report: an auto-reply or a person writing back. Read, and left.
      if (!returned)
        return true
      const teams = await teamsThatWroteTo(returned.recipient).catch((error: unknown) => {
        // Said out loud: a report that cannot be recorded stays unread and is
        // tried again, and silence here is a bounce nobody ever counts.
        log.error(`[commshq:returned-mail] could not look up who wrote to a returned address: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      })
      for (const teamId of teams) {
        await ensureSuppressed({ teamId, channel: 'email', recipient: returned.recipient, reason: returned.kind, source: 'returned_mail' })
        if (returned.kind === 'bounce')
          bounces++
        else
          complaints++
      }
      return true
    })
    if (bounces || complaints)
      log.info(`[commshq:returned-mail] ${result.read} read, ${bounces} bounce(s) and ${complaints} complaint(s) recorded`)
    return { ...result, bounces, complaints }
  },
})
