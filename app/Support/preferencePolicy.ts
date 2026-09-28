export function parsePreferenceChoice(value: unknown): boolean | null {
  if (value === true || value === false) return value
  const normalized = String(value ?? '').trim().toLowerCase()
  if (['enabled', 'true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['disabled', 'false', '0', 'no', 'off'].includes(normalized)) return false
  return null
}
