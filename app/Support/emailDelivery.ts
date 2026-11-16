import { assertUsageAvailable } from '@stacksjs/newsletter'
import { CommunicationSuppression, ConsentEvent } from '@stacksjs/orm'
import UsageMeter from '../Models/UsageMeter'

/**
 * The two checks every outbound marketing message passes, shared by the
 * campaign sender and the automation runner so the rules cannot drift.
 *
 * Consent: the address is not suppressed, and the latest consent entry for
 * it grants or confirms. No entry at all is no consent.
 */
export async function consentAllows(teamId: number, channel: 'email' | 'sms', recipient: string): Promise<boolean> {
  const suppression = await CommunicationSuppression.where('team_id', teamId).where('channel', channel).where('recipient', recipient).first()
  if (suppression && !suppression.liftedAt) return false
  const consent = await ConsentEvent.where('team_id', teamId).where('channel', channel).where('recipient', recipient).orderByDesc('occurredAt').first()
  return !!consent && ['granted', 'confirmed'].includes(String(consent.action))
}

/** Quota: a workspace with no meter for the channel has a limit of zero. */
export async function assertQuota(teamId: number, channel: 'email' | 'sms', requested: number): Promise<void> {
  const meterKey = channel === 'sms' ? 'sms_segments' : 'emails'
  const meter = await UsageMeter.where('team_id', teamId).where('key', meterKey).orderByDesc('periodStart').first()
  const limit = !meter ? 0 : meter.includedQuantity == null ? null : Number(meter.includedQuantity)
  assertUsageAvailable([{ meter: meterKey, used: Number(meter?.quantity || 0), limit, requested }])
}
