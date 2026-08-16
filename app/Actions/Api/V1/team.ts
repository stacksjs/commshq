import type { RequestInstance } from '@stacksjs/types'

export async function activeTeamId(request: RequestInstance): Promise<number | null> {
  const user = await request.user()
  const value = user?.current_team_id ?? user?.team_id
  const teamId = Number(value)
  return Number.isInteger(teamId) && teamId > 0 ? teamId : null
}
