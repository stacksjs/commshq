import { Job } from '@stacksjs/queue'
import WebhookEvent from '../Models/WebhookEvent'

export default new Job({
  name: 'RetryFailedWebhooks', description: 'Requeues recoverable verified webhook events', queue: 'scheduler', tries: 3, backoff: [30, 120],
  async handle() {
    const events = await WebhookEvent.where('status', 'failed').where('attempts', '<', 5).limit(100).get()
    for (const event of events)
      await ProcessWebhookEvent.dispatch({ eventId: event.id, teamId: Number(event.team_id) })
    return { queued: events.length }
  },
})
