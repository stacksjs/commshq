import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { isUniqueViolation } from '@stacksjs/orm'
import { response } from '@stacksjs/router'
import { parsePlatform, profileKindFor } from '../../../Reputation/platforms'
import { isSupported, supportedPlatforms } from '../../../Reputation/providers'
import AuditEvent from '../../../../Models/AuditEvent'
import MonitoredProfile from '../../../../Models/MonitoredProfile'
import { canManageReputation } from '../../../Reputation/policy'
import { activeTeamId } from '../team'

export default new Action({
  name: 'Create Monitored Profile',
  description: 'Registers a social handle or business listing for reputation monitoring',
  method: 'POST',

  async handle(request: RequestInstance) {
    const teamId = await activeTeamId(request)
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canManageReputation((user as any).team_role)) return response.json({ error: 'Monitoring setup requires an admin or owner role' }, 403)

    const platform = parsePlatform(request.get('platform'))
    if (!platform) return response.json({ error: 'Unsupported platform' }, 422)
    if (!isSupported(platform))
      return response.json({ error: `No connector is available for ${platform} yet`, supported: supportedPlatforms() }, 422)

    const externalId = String(request.get('externalId') || '').trim()
    const displayName = String(request.get('displayName') || '').trim()
    if (!externalId || externalId.length > 255) return response.json({ error: 'externalId is required and must be 255 characters or fewer' }, 422)
    if (!displayName || displayName.length > 160) return response.json({ error: 'displayName is required and must be 160 characters or fewer' }, 422)

    const rawInterval = request.get('pollIntervalMinutes')
    const pollIntervalMinutes = rawInterval === undefined || rawInterval === null || rawInterval === '' ? 30 : Number(rawInterval)
    if (!Number.isInteger(pollIntervalMinutes) || pollIntervalMinutes < 5 || pollIntervalMinutes > 1_440)
      return response.json({ error: 'pollIntervalMinutes must be an integer between 5 and 1440' }, 422)

    const handle = String(request.get('handle') || '').trim() || null
    const locationLabel = String(request.get('locationLabel') || '').trim() || null
    const profileUrl = String(request.get('profileUrl') || '').trim() || null

    try {
      const profile = await MonitoredProfile.forceCreate({
        team_id: teamId,
        platform,
        kind: profileKindFor(platform),
        displayName,
        handle,
        externalId,
        locationLabel,
        profileUrl,
        // The first sync decides whether the credential works; until then the
        // profile is honestly reported as not yet configured.
        status: 'unconfigured',
        pollIntervalMinutes,
        nextPollAt: new Date().toISOString(),
        consecutiveFailures: 0,
      })

      await AuditEvent.forceCreate({
        team_id: teamId,
        user_id: Number(user.id),
        action: 'monitored_profile.created',
        subjectType: 'MonitoredProfile',
        subjectId: String(profile.id),
        metadata: JSON.stringify({ platform, externalId }),
        occurredAt: new Date().toISOString(),
      })

      return response.json({ data: profile }, 201)
    }
    catch (error) {
      if (isUniqueViolation(error))
        return response.json({ error: 'This profile is already monitored' }, 409)
      throw error
    }
  },
})
