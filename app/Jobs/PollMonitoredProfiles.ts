import { Job } from '@stacksjs/queue'
import MonitoredProfile from '../Models/MonitoredProfile'
import SyncMonitoredProfile from './SyncMonitoredProfile'

/** Bounded so one crowded tick cannot flood the integrations queue. */
const BATCH_SIZE = 200

export default new Job({
  name: 'PollMonitoredProfiles',
  description: 'Queues a sync for every monitored profile whose poll interval has elapsed',
  queue: 'scheduler',
  tries: 3,
  backoff: [15, 60],

  async handle() {
    const due = await MonitoredProfile
      .where('status', 'active')
      .where('nextPollAt', '<=', new Date().toISOString())
      .orderBy('nextPollAt')
      .limit(BATCH_SIZE)
      .get()

    for (const profile of due)
      await SyncMonitoredProfile.dispatch({ profileId: Number(profile.id), teamId: Number(profile.team_id) })

    return { queued: due.length }
  },
})
