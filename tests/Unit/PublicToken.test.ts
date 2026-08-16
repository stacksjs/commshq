import { describe, expect, it } from 'bun:test'
import { createPublicToken, verifyPublicToken } from '../../app/Actions/Public/signed-token'

describe('public preference tokens', () => {
  const secret = 'test-signing-key'
  const payload = { teamId: 4, contactId: 9, channel: 'email' as const, purpose: 'confirm' as const, expiresAt: 2_000 }

  it('round-trips a valid signed token', () => {
    expect(verifyPublicToken(createPublicToken(payload, secret), secret, 1_000)).toEqual(payload)
  })

  it('rejects expiry and tampering', () => {
    const token = createPublicToken(payload, secret)
    expect(verifyPublicToken(token, secret, 2_001)).toBeNull()
    expect(verifyPublicToken(`${token}x`, secret, 1_000)).toBeNull()
  })
})
