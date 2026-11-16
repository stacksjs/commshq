import { assertUsageAvailable } from '@stacksjs/newsletter'
import { CommunicationSuppression, ConsentEvent } from '@stacksjs/orm'
import UsageMeter from '../Models/UsageMeter'
import { ensureOpenMetersNow } from './usagePeriods'

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

/**
 * Quota: what the workspace has left of this month's allowance. A workspace
 * with no meter for the channel has a limit of zero.
 *
 * This month's, and not the latest row's: the latest row used to be read
 * whatever month it was for, so a workspace went on counting against the
 * month it was set up in and its allowance was never given back.
 */
export async function assertQuota(teamId: number, channel: 'email' | 'sms', requested: number): Promise<void> {
  const meterKey = channel === 'sms' ? 'sms_segments' : 'emails'
  await ensureOpenMetersNow(teamId)
  const now = new Date().toISOString()
  const meter = await UsageMeter.where('team_id', teamId).where('key', meterKey).where('periodStart', '<=', now).where('periodEnd', '>', now).orderByDesc('periodStart').first()
  const limit = !meter ? 0 : meter.includedQuantity == null ? null : Number(meter.includedQuantity)
  assertUsageAvailable([{ meter: meterKey, used: Number(meter?.quantity || 0), limit, requested }])
}
