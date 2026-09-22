import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth, consumeTwoFactorChallenge, verifyTwoFactorLoginCode } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { schema } from '@stacksjs/validation'
import { buildAuthCookie, sessionExpiryMinutes } from './authCookie'

/**
 * Step two of a 2FA sign-in: exchange the short-lived challenge token that
 * LoginAction issued, plus the account's current TOTP code, for a real token
 * pack. Mirrors LoginAction's cookie contract so a 2FA account ends the flow
 * with the same HttpOnly `auth-token` cookie every other session path sets.
 * See authCookie.ts.
 */
export default new Action({
  name: 'VerifyTwoFactorLoginAction',
  description: 'Exchange a LoginAction 2FA challenge + TOTP code for a real token pack',
  method: 'POST',

  validations: {
    challenge_token: {
      rule: schema.string().min(1),
      message: 'A challenge token is required.',
    },
    code: {
      rule: schema.string().min(6).max(6),
      message: 'Code must be a 6-digit TOTP code.',
    },
  },

  async handle(request: RequestInstance) {
    const challengeToken = request.get('challenge_token')
    const code = request.get('code')

    // Single-use: a second attempt with the same challenge token (whether the
    // code was right or wrong) must start over from LoginAction, not retry.
    const userId = await consumeTwoFactorChallenge(challengeToken)
    if (!userId)
      return response.unauthorized('This login attempt has expired — please sign in again.')

    const valid = await verifyTwoFactorLoginCode(userId, code)
    if (!valid)
      return response.unauthorized('Invalid code — please sign in again.')

    // Carry the "remember me" tier the user chose on step 1 through to the
    // session issued here, so a 2FA account is not silently downgraded to the
    // baseline week. The login page re-sends the checkbox with the TOTP code.
    const expiresInMinutes = sessionExpiryMinutes(request.get('remember'))
    const result = await Auth.loginUsingId(userId, { expiresInMinutes })
    if (!result)
      return response.unauthorized('Invalid code — please sign in again.')

    const user = result.user

    return response.json(
      {
        access_token: result.token,
        refresh_token: result.refreshToken,
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        token: result.token,
        user: {
          id: user?.id,
          email: user?.email,
          name: user?.name,
        },
      },
      { status: 200, headers: { 'Set-Cookie': buildAuthCookie(result.token, result.expiresIn) } },
    )
  },
})
