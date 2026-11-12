/**
 * Workspace settings, through the application's own API.
 *
 * This page was the `settings` area of `WorkspaceSurface`: a "configuration
 * health" of 98%, a policy version, six retention rules, a timezone, consent
 * defaults and an AI publishing policy, with a Save button that saved
 * nothing. None of those is stored for a workspace.
 *
 * What a workspace does have is a name and a short description. The name is
 * what the command center greets people with and what an invitation says
 * they are joining, and until now nobody could change it. This page reads
 * and writes those two fields through `/api/v1/workspace/settings`.
 *
 * ## What the page does not show
 *
 * No timezone, locale, consent defaults, approval policy, retention rules or
 * AI quotas. Consent and quiet hours are how the application behaves for
 * every workspace, the timezone is the deployment's, and retention policies
 * can be stored but nothing enforces one, so a control for any of them would
 * be a switch connected to nothing.
 */
import { formatSeen } from './contacts-query'

export const SETTINGS_ENDPOINT = '/api/v1/workspace/settings'

/** The limits `app/Support/workspaceSettings.ts` enforces. A test holds them together. */
export const WORKSPACE_NAME_MIN = 2
export const WORKSPACE_NAME_MAX = 80
export const WORKSPACE_DESCRIPTION_MAX = 280

export interface SettingsRow {
  id?: number | null
  name?: string | null
  description?: string | null
  created_at?: string | null
  canEdit?: boolean | null
}

export interface SettingsView {
  name: string
  description: string
  canEdit: boolean
  createdLabel: string
}

export function toSettingsView(body: { data?: SettingsRow | null } | null | undefined, locale?: string): SettingsView {
  const row = body?.data ?? {}
  const created = row.created_at ? formatSeen(String(row.created_at).replace(' ', 'T'), locale) : '-'
  return {
    name: (row.name || '').trim(),
    description: (row.description || '').trim(),
    canEdit: row.canEdit === true,
    createdLabel: created === '-' ? '' : `Workspace created ${created}.`,
  }
}

export interface SettingsDraft {
  name?: string
  description?: string
}

/** Why a draft cannot be saved, by the rules the server applies. */
export function settingsDraftError(draft: SettingsDraft): string {
  const name = (draft.name ?? '').trim().replace(/ {2,}/g, ' ')
  const description = (draft.description ?? '').trim()
  if (name.length < WORKSPACE_NAME_MIN)
    return `A workspace name needs at least ${WORKSPACE_NAME_MIN} characters.`
  if (name.length > WORKSPACE_NAME_MAX)
    return `A workspace name can be at most ${WORKSPACE_NAME_MAX} characters.`
  if (description.length > WORKSPACE_DESCRIPTION_MAX)
    return `A description can be at most ${WORKSPACE_DESCRIPTION_MAX} characters.`
  return ''
}

export function settingsPayload(draft: SettingsDraft): { name: string, description: string } {
  return {
    name: (draft.name ?? '').trim().replace(/ {2,}/g, ' '),
    description: (draft.description ?? '').trim(),
  }
}

/** Whether the form differs from what was last read, so Save has something to do. */
export function isChanged(draft: SettingsDraft, saved: { name: string, description: string }): boolean {
  const payload = settingsPayload(draft)
  return payload.name !== saved.name || payload.description !== saved.description
}

/** What to tell someone when the settings could not be read. */
export function settingsLoadError(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your settings.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so there are no settings to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Settings could not be loaded because the API is not answering.'
  return `Settings could not be loaded (${status}).`
}

/** What to tell someone when a save was refused. */
export function settingsSaveError(status: number): string {
  if (status === 422)
    return 'Those settings were rejected. Check the length of the name and the description.'
  if (status === 403)
    return 'Only a workspace owner or admin can change these settings.'
  if (status === 401)
    return 'Your session has ended. Sign in again to save.'
  if (status === 429)
    return 'Too many attempts just now. Wait a minute and try again.'
  return `The settings could not be saved (${status}).`
}
