import { createHash } from 'node:crypto'

export type ConsentChannel = 'email' | 'sms'
export type ConsentAction = 'requested' | 'granted' | 'revoked' | 'confirmed' | 'suppressed'

interface ConsentKeyInput {
  scope: string
  token: string
  channel: ConsentChannel
  action: ConsentAction
  predecessorId?: number | string | null
}

interface ConsentEventInput {
  teamId: number
  recipient: string
  channel: ConsentChannel
  action: ConsentAction
  source: string
  idempotencyKey: string
  purpose?: string
  policyVersion?: string
  proof?: string
  jurisdiction?: string
  ipAddress?: string
}

interface SuppressionInput {
  teamId: number
  recipient: string
  channel: ConsentChannel
  source: string
  reason?: 'unsubscribe' | 'bounce' | 'complaint' | 'carrier' | 'manual' | 'legal'
}

export function consentIdempotencyKey(input: ConsentKeyInput): string {
  const tokenDigest = createHash('sha256').update(input.token).digest('hex')
  const predecessor = input.predecessorId == null ? 'origin' : String(input.predecessorId)
  return `public:${input.scope}:${input.channel}:${input.action}:${predecessor}:${tokenDigest}`
}

export function consentStateMatches(event: any, action: ConsentAction, source: string): boolean {
  return !!event && String(event.action) === action && String(event.source) === source
}

export async function findLatestConsent(teamId: number, channel: ConsentChannel, recipient: string): Promise<any | null> {
  return ConsentEvent
    .where('team_id', teamId)
    .where('channel', channel)
    .where('recipient', recipient)
    .orderByDesc('occurredAt')
    .first()
}

export async function findConsentByKey(teamId: number, idempotencyKey: string): Promise<any | null> {
  return ConsentEvent
    .where('team_id', teamId)
    .where('idempotency_key', idempotencyKey)
    .first()
}

export async function appendConsentOnce(input: ConsentEventInput): Promise<boolean> {
  const findExisting = () => findConsentByKey(input.teamId, input.idempotencyKey)
  if (await findExisting()) return false

  try {
    await ConsentEvent.create({
      team_id: input.teamId,
      recipient: input.recipient,
      channel: input.channel,
      action: input.action,
      purpose: input.purpose ?? 'marketing',
      source: input.source,
      jurisdiction: input.jurisdiction,
      policyVersion: input.policyVersion ?? '1.0',
      idempotencyKey: input.idempotencyKey,
      proof: input.proof,
      ipAddress: input.ipAddress,
      occurredAt: new Date().toISOString(),
    })
    return true
  }
  catch (error) {
    if (await findExisting()) return false
    throw error
  }
}

export async function findActiveSuppression(teamId: number, channel: ConsentChannel, recipient: string): Promise<any | null> {
  if (!recipient) return null
  return CommunicationSuppression
    .where('team_id', teamId)
    .where('channel', channel)
    .where('recipient', recipient)
    .whereNull('liftedAt')
    .first()
}

export async function ensureSuppressed(input: SuppressionInput): Promise<void> {
  if (!input.recipient || await findActiveSuppression(input.teamId, input.channel, input.recipient)) return

  const existing = await CommunicationSuppression
    .where('team_id', input.teamId)
    .where('channel', input.channel)
    .where('recipient', input.recipient)
    .first()

  if (existing) {
    await CommunicationSuppression.forceUpdate(existing.id, {
      reason: input.reason ?? 'unsubscribe',
      source: input.source,
      suppressedAt: new Date().toISOString(),
      liftedAt: null,
    })
    return
  }

  try {
    await CommunicationSuppression.create({
      team_id: input.teamId,
      recipient: input.recipient,
      channel: input.channel,
      reason: input.reason ?? 'unsubscribe',
      source: input.source,
      suppressedAt: new Date().toISOString(),
    })
  }
  catch (error) {
    if (await findActiveSuppression(input.teamId, input.channel, input.recipient)) return
    throw error
  }
}
