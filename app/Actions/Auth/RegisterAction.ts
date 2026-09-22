import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth, register } from '@stacksjs/auth'
import { dispatch } from '@stacksjs/events'
import { response } from '@stacksjs/router'
import { schema } from '@stacksjs/validation'
import { buildAuthCookie } from './authCookie'

/**
 * Project override of the framework's default RegisterAction, mounted at the
 * same `Actions/Auth/RegisterAction` route string (app actions win over the
 * framework defaults).
 *
 * Same registration flow as the framework default — register, fire
 * `user:registered`, return the OAuth2 payload — with one change: the issued
 * bearer is mirrored into the HttpOnly `auth-token` cookie via the shared
 * buildAuthCookie, exactly like LoginAction, so the post-signup redirect to a
 * server-rendered page can resolve the brand-new session. See authCookie.ts.
 *
 * Unlike statushq's RegisterAction this does NOT create a personal team:
 * commshq has no app TeamMember model or createPersonalTeam helper. The 8/255
 * password rule matches the framework password policy (storage/framework/
 * defaults/app/password-policy.ts) and the browser-side check in register.stx.
 */
export default new Action({
  name: 'RegisterAction',
  description: 'Register a new user',
  method: 'POST',

  validations: {
    email: {
      rule: schema.string().email(),
      message: 'Email must be a valid email address.',
    },
    password: {
      rule: schema.string().min(8).max(255),
      message: 'Password must be between 8 and 255 characters.',
    },
    name: {
      rule: schema.string().min(2).max(255),
      message: 'Name must be between 2 and 255 characters.',
    },
  },

  async handle(request: RequestInstance) {
    const email = request.get('email')
    const password = request.get('password')
    const name = request.get('name')

    const result = await register({ email, password, name })

    if (result) {
      const user = await Auth.getUserFromToken(result.token)

      // Fire `user:registered` so app/Events.ts listeners (welcome email, CRM
      // sync, etc.) run. Fire-and-forget — listener errors are swallowed by the
      // wildcard handler so a flaky welcome email doesn't fail registration.
      // The `to` alias is what SendWelcomeEmail addresses the mail to, and the
      // registering address is the honest fallback if the freshly-created user
      // could not be read back.
      dispatch('user:registered', {
        id: user?.id,
        email: user?.email ?? email,
        name: user?.name,
        to: user?.email ?? email,
      })

      // Same OAuth2-compatible payload LoginAction returns, so a client can
      // code against one shape. The token also goes out as the HttpOnly
      // auth-token cookie, so the very next server-rendered page can identify
      // the account without the client handing it anything.
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
        { headers: { 'Set-Cookie': buildAuthCookie(result.token, result.expiresIn) } },
      )
    }

    return response.error('Registration failed')
  },
})
