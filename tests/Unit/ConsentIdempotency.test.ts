import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appendConsentOnce, consentIdempotencyKey, consentStateMatches, ensureSuppressed } from '../../app/Actions/Public/consent-ledger'

const originalConsentModel = (globalThis as any).ConsentEvent
const originalSuppressionModel = (globalThis as any).CommunicationSuppression

afterEach(() => {
  ;(globalThis as any).ConsentEvent = originalConsentModel
  ;(globalThis as any).CommunicationSuppression = originalSuppressionModel
})

describe('public consent idempotency', () => {
  it('generates a stable key without exposing the signed token', () => {
    const input = { scope: 'unsubscribe', token: 'signed.secret.token', channel: 'email' as const, action: 'revoked' as const, predecessorId: 42 }
    const first = consentIdempotencyKey(input)

    expect(consentIdempotencyKey(input)).toBe(first)
    expect(first).not.toContain(input.token)
    expect(first.length).toBeLessThanOrEqual(255)
  })

  it('allows a later state transition while deduplicating the same transition', () => {
    const base = { scope: 'preferences', token: 'signed-token', channel: 'email' as const, action: 'revoked' as const }

    expect(consentIdempotencyKey({ ...base, predecessorId: 10 })).toBe(consentIdempotencyKey({ ...base, predecessorId: 10 }))
    expect(consentIdempotencyKey({ ...base, predecessorId: 10 })).not.toBe(consentIdempotencyKey({ ...base, predecessorId: 11 }))
  })

  it('matches both the consent action and its evidence source', () => {
    expect(consentStateMatches({ action: 'revoked', source: 'one_click' }, 'revoked', 'one_click')).toBe(true)
    expect(consentStateMatches({ action: 'revoked', source: 'webhook' }, 'revoked', 'one_click')).toBe(false)
    expect(consentStateMatches(null, 'revoked', 'one_click')).toBe(false)
  })

  it('guards confirmation replay before lifting a newer suppression', () => {
    const action = readFileSync(resolve(import.meta.dir, '../../app/Actions/Public/ConfirmSubscriptionAction.ts'), 'utf8')
    const replayGuard = action.indexOf('if (await findConsentByKey')
    const suppressionLookup = action.indexOf('CommunicationSuppression')

    expect(replayGuard).toBeGreaterThan(-1)
    expect(replayGuard).toBeLessThan(suppressionLookup)
  })

  it('reactivates a previously lifted suppression', async () => {
    let update: Record<string, unknown> | undefined
    const existing = { id: 7, liftedAt: '2026-09-01T00:00:00.000Z' }
    const query: any = {
      first: async () => existing,
      where: () => query,
      whereNull: () => ({ first: async () => null }),
    }
    ;(globalThis as any).CommunicationSuppression = {
      forceUpdate: async (_id: number, values: Record<string, unknown>) => { update = values },
      where: () => query,
    }

    await ensureSuppressed({ teamId: 1, channel: 'email', recipient: 'person@example.com', source: 'one_click' })

    expect(update).toMatchObject({ liftedAt: null, reason: 'unsubscribe', source: 'one_click' })
  })

  it('treats a concurrent unique-key winner as an idempotent replay', async () => {
    let reads = 0
    const query: any = {
      first: async () => ++reads === 1 ? null : { id: 9 },
      where: () => query,
    }
    ;(globalThis as any).ConsentEvent = {
      create: async () => { throw new Error('unique constraint') },
      where: () => query,
    }

    const created = await appendConsentOnce({
      teamId: 1,
      recipient: 'person@example.com',
      channel: 'email',
      action: 'revoked',
      source: 'one_click',
      idempotencyKey: 'public:unsubscribe:email:revoked:origin:digest',
    })

    expect(created).toBe(false)
    expect(reads).toBe(2)
  })

  it('routes every public consent writer through the idempotent ledger', () => {
    const files = [
      'SubscribeAction.ts',
      'UnsubscribeAction.ts',
      'ConfirmSubscriptionAction.ts',
      'UpdatePreferencesAction.ts',
    ]

    for (const file of files) {
      const action = readFileSync(resolve(import.meta.dir, `../../app/Actions/Public/${file}`), 'utf8')
      expect(action).toContain('appendConsentOnce')
      expect(action).not.toContain('ConsentEvent.create')
    }

    const subscribe = readFileSync(resolve(import.meta.dir, '../../app/Actions/Public/SubscribeAction.ts'), 'utf8')
    const preferences = readFileSync(resolve(import.meta.dir, '../../app/Actions/Public/UpdatePreferencesAction.ts'), 'utf8')
    expect(subscribe).toContain('.withIdempotencyKey(')
    expect(preferences).toContain('.withIdempotencyKey(')
  })
})
