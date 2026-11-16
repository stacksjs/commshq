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
    .job('ResumeAutomationRuns')
    .everyMinute()
    .setTimeZone('UTC')

  schedule
    .job('RetryFailedWebhooks')
    .everyFiveMinutes()
    .setTimeZone('UTC')

  schedule
    .job('PollMonitoredProfiles')
    .everyFiveMinutes()
    .setTimeZone('UTC')

  // Bounces and spam complaints, read from the mailbox they come back to:
  // what the sending limits in app/Hq/standing.ts count.
  schedule
    .job('ProcessReturnedMail')
    .everyFiveMinutes()
    .setTimeZone('UTC')

  schedule
    .job('EvaluateReputationAlerts')
    .everyFiveMinutes()
    .setTimeZone('UTC')
}

process.on('SIGINT', () => {
  schedule.gracefulShutdown().then(() => process.exit(0))
})
