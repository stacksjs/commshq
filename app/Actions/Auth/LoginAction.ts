import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth, createTwoFactorChallenge, getTwoFactorState } from '@stacksjs/auth'
import { User } from '@stacksjs/orm'
import { response } from '@stacksjs/router'
import { schema } from '@stacksjs/validation'
import { buildAuthCookie, sessionExpiryMinutes } from './authCookie'

/**
 * Project override of the framework's default LoginAction, mounted at the same
 * `Actions/Auth/LoginAction` route string (app actions win over the framework
 * defaults).
 *
 * Identical credential/2FA flow to the framework default, with two additions:
 * the session length is set once here from the "remember me" checkbox (a week
 * by default, 30 days when checked), and the issued bearer is mirrored into an
 * HttpOnly `config.auth.defaultTokenName` cookie whose Max-Age is stamped from
 * the SAME number. commshq's `.stx` pages render server-side straight from
 * SQLite with no client hydration, so a cookie — not an Authorization header —
 * is how a document render resolves "who's logged in". See authCookie.ts.
 */
export default new Action({
  name: 'LoginAction',
  description: 'Login to the application',
  method: 'POST',

  validations: {
    email: {
      rule: schema.string().email(),
      message: 'Email must be a valid email address.',
    },
    password: {
      rule: schema.string().min(6).max(255),
      message: 'Password must be between 6 and 255 characters.',
    },
  },

  async handle(request: RequestInstance) {
    const email = request.get('email')
    const password = request.get('password')

    // Verify credentials WITHOUT minting tokens yet — if the account
    // has TOTP 2FA enabled, no token pack should exist until the code
    // is also verified (VerifyTwoFactorLoginAction mints the real pack).
    const isValid = await Auth.attempt({ email, password })
    if (!isValid)
      return response.unauthorized('Incorrect email or password')

    const authedUser = await User.where('email', '=', email).first()
    if (!authedUser)
      return response.unauthorized('Incorrect email or password')

    const { enabled: twoFactorEnabled } = await getTwoFactorState(authedUser.id as number)
    if (twoFactorEnabled) {
      const challengeToken = await createTwoFactorChallenge(authedUser.id as number)
      return response.json({
        requires_two_factor: true,
        challenge_token: challengeToken,
      })
    }

    // Session length is set once, here, from the "remember me" checkbox: a
    // week by default, 30 days when checked. See sessionExpiryMinutes.
    const expiresInMinutes = sessionExpiryMinutes(request.get('remember'))
    const result = await Auth.loginUsingId(authedUser.id as number, { expiresInMinutes })
    if (!result)
      return response.unauthorized('Incorrect email or password')

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
