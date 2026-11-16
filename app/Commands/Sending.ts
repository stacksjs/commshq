import { defineCommand, log } from '@stacksjs/cli'
import { sqlRun } from '../Support/sqlRun'

/**
 * Paused senders, and lifting a pause.
 *
 * An app is paused by its numbers (app/Hq/standing.ts) and stays paused until
 * a person has looked: that person runs this. A workspace cannot lift its own
 * pause, which is the point of one.
 */
export default defineCommand((cli) => {
  cli.command('sending:paused', 'List the connected apps whose sending is paused').action(async () => {
    const rows = await sqlRun('SELECT a.uuid, a.name, a.team_id, a.sending_paused_at, a.sending_paused_reason FROM connected_apps a WHERE a.sending_paused_at IS NOT NULL ORDER BY a.sending_paused_at DESC')
    if (rows.length === 0) {
      log.info('No app is paused.')
      return
    }
    for (const row of rows)
      log.info(`${row.uuid}  ${row.name} (workspace ${row.team_id})  since ${new Date(row.sending_paused_at as string).toISOString()}  ${row.sending_paused_reason}`)
  })

  cli.command('sending:resume <app>', 'Lift the pause on a connected app, by its id').action(async (app: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(app)) {
      log.error('Give the app\'s id, as `buddy sending:paused` prints it.')
      return
    }
    const rows = await sqlRun('UPDATE connected_apps SET sending_paused_at = NULL, sending_paused_reason = NULL, updated_at = ? WHERE uuid = ? AND sending_paused_at IS NOT NULL RETURNING name', [new Date().toISOString(), app])
    if (rows.length === 0)
      log.warn('No paused app has that id.')
    else
      log.success(`${rows[0]!.name} may send again. Its bounces and complaints still count: it is paused again if the next week looks the same.`)
  })
})
