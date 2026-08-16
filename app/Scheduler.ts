import process from 'node:process'
import { schedule } from '@stacksjs/scheduler'

/**
 * **Scheduler**
 *
 * Define your scheduled tasks here. Jobs, actions, and shell commands
 * can all be scheduled with a fluent, expressive API.
 *
 * @see https://docs.stacksjs.com/scheduling
 */
export default function () {
  schedule
    .job('DispatchDueCampaigns')
    .everyMinute()
    .setTimeZone('UTC')

  schedule
    .job('RetryFailedWebhooks')
    .everyFiveMinutes()
    .setTimeZone('UTC')
}

process.on('SIGINT', () => {
  schedule.gracefulShutdown().then(() => process.exit(0))
})
