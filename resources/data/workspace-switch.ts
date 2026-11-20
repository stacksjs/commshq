/**
 * The workspace switcher's data: which workspaces the person has, which one is
 * open, and what to say when switching fails.
 *
 * The server decides the open workspace (the framework's `active_team`
 * cookie, checked against the person's memberships), so this only shapes
 * its answer for the menu.
 */

export const WORKSPACES_ENDPOINT = '/api/v1/workspaces'
export const SWITCH_ENDPOINT = '/api/v1/workspaces/active'

export interface WorkspaceOption {
  id: number
  name: string
  roleLabel: string
}

export interface WorkspaceMenu {
  activeName: string
  activeRoleLabel: string
  /** The workspaces the person can switch to: every one but the open one. */
  others: WorkspaceOption[]
  canSwitch: boolean
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

export function roleLabel(role: unknown): string {
  return ROLE_LABELS[String(role ?? '')] ?? ''
}

export function toWorkspaceMenu(body: unknown): WorkspaceMenu {
  const data = (body as { data?: { activeId?: unknown, workspaces?: unknown } } | null)?.data
  const activeId = Number(data?.activeId)
  const rows = Array.isArray(data?.workspaces) ? data.workspaces as Array<Record<string, unknown>> : []
  const options = rows
    .map(row => ({ id: Number(row.id), name: String(row.name ?? '').trim(), role: row.role }))
    .filter(row => Number.isInteger(row.id) && row.id > 0 && row.name)
  const active = options.find(row => row.id === activeId)
  const others = options
    .filter(row => row.id !== activeId)
    .map(row => ({ id: row.id, name: row.name, roleLabel: roleLabel(row.role) }))
  return {
    activeName: active?.name ?? '',
    activeRoleLabel: roleLabel(active?.role),
    others,
    canSwitch: others.length > 0,
  }
}

export function switchErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to switch workspace.'
  if (status === 404)
    return 'You no longer belong to that workspace.'
  if (status === 429)
    return 'Too many switches in a row. Wait a minute and try again.'
  return 'That workspace could not be opened. Try again.'
}
