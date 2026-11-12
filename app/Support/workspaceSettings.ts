/**
 * The settings a workspace actually has: its name and a short description.
 *
 * The settings page used to list a timezone, consent defaults, an AI
 * publishing policy, retention rules and a "configuration health" score.
 * None of those is stored per workspace. The `teams` row holds a name and a
 * description, and those are what this module validates.
 */
export const WORKSPACE_NAME_MIN = 2
export const WORKSPACE_NAME_MAX = 80
export const WORKSPACE_DESCRIPTION_MAX = 280

// Control characters, including the line breaks a name must not carry into
// an email subject or a page title.
const CONTROL = /[\u0000-\u001F\u007F]/

/** A name as stored: trimmed, inner runs of space collapsed. Undefined when it is not one. */
export function normalizeWorkspaceName(value: unknown): string | undefined {
  if (typeof value !== 'string' || CONTROL.test(value))
    return undefined
  const name = value.trim().replace(/ {2,}/g, ' ')
  if (name.length < WORKSPACE_NAME_MIN || name.length > WORKSPACE_NAME_MAX)
    return undefined
  return name
}

/**
 * A description as stored: trimmed, null when blank. Undefined when it is too
 * long or carries control characters other than a line break.
 */
export function normalizeWorkspaceDescription(value: unknown): string | null | undefined {
  if (value === undefined || value === null)
    return null
  if (typeof value !== 'string' || CONTROL.test(value.replace(/\n/g, '')))
    return undefined
  const description = value.trim()
  if (description.length > WORKSPACE_DESCRIPTION_MAX)
    return undefined
  return description || null
}

/** Renaming a workspace changes what every member and every invitation shows. */
export function canEditWorkspace(role: unknown): boolean {
  return ['owner', 'admin'].includes(String(role || '').toLowerCase())
}
