export type ConsentAction = 'granted' | 'confirmed' | 'revoked' | 'unsubscribed' | 'suppressed'

export interface ConsentRecord {
  action: ConsentAction | string
  occurredAt: string | Date
}

export interface SuppressionRecord {
  liftedAt?: string | Date | null
}

export function canDeliver(suppression: SuppressionRecord | null, consentEvents: ConsentRecord[]): boolean {
  if (suppression && !suppression.liftedAt) return false

  const latest = consentEvents
    .toSorted((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .at(0)

  return latest?.action === 'granted' || latest?.action === 'confirmed'
}

export function normalizedRecipient(channel: 'email' | 'sms', recipient: string): string {
  const value = recipient.trim().toLowerCase()
  return channel === 'sms' ? value.replace(/[^+\d]/g, '') : value
}
