/** Setting up monitoring changes what the workspace pays for and who gets paged. */
const MANAGE_ROLES = new Set(['owner', 'admin'])
/** Triaging a mention or acknowledging an alert is day-to-day inbox work. */
const TRIAGE_ROLES = new Set(['owner', 'admin', 'editor', 'member'])

export function canManageReputation(role: unknown): boolean {
  return MANAGE_ROLES.has(String(role || '').toLowerCase())
}

export function canTriageReputation(role: unknown): boolean {
  return TRIAGE_ROLES.has(String(role || '').toLowerCase())
}
