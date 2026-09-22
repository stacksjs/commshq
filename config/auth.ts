import type { AuthConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

/**
 * **Authentication Configuration**
 *
 * This configuration defines all of your authentication options. Because Stacks is fully-typed,
 * you may hover any of the options below and the definitions will be provided. In case
 * you have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  enabled: true,

  /**
   * The authentication guard to use for your application.
   */
  default: 'api',

  /**
   * The authentication guards available for your application.
   */
  guards: {
    api: {
      driver: 'token',
      provider: 'users',
    },
  },

  /**
   * The authentication providers available for your application.
   */
  providers: {
    users: {
      driver: 'database',
      table: 'users',
    },
  },

  /**
   * The username field used for authentication.
   */
  username: env.AUTH_USERNAME_FIELD || 'email',

  /**
   * The password field used for authentication.
   */
  password: env.AUTH_PASSWORD_FIELD || 'password',

  /**
   * Token / session expiry in milliseconds (default: 7 days).
   *
   * This value IS the browser session length. `Auth.loginUsingId(id, { expiresInMinutes })`
   * stamps the `oauth_access_tokens.expires_at` row and the auth-token cookie's
   * Max-Age from one number, and nothing extends either afterwards, so it is the
   * real session cap. 7 days is the baseline; the login form's "keep me signed
   * in" checkbox overrides it per-login to 30 days (see app/Actions/Auth/authCookie.ts
   * sessionExpiryMinutes). There is no short-access + refresh-rotation split any
   * more: the cookie is the session.
   */
  tokenExpiry: env.AUTH_TOKEN_EXPIRY || 7 * 24 * 60 * 60 * 1000,

  /**
   * Refresh-token expiry in milliseconds. NOT WIRED UP: a refresh token is
   * still minted and returned in the OAuth2 payload, but nothing consumes it —
   * there is no `/auth/refresh` route. The session ends when `tokenExpiry`
   * elapses. Kept only for the payload shape.
   */
  refreshTokenExpiry: env.AUTH_REFRESH_TOKEN_EXPIRY || 30 * 24 * 60 * 60 * 1000,

  /**
   * Token rotation time in hours. Inert now that there is no refresh route to
   * rotate on; required by the config type, so kept at its default.
   */
  tokenRotation: env.AUTH_TOKEN_ROTATION || 24,

  /**
   * The token abilities that are granted by default.
   */
  defaultAbilities: ['*'],

  /**
   * The token name used when creating new tokens.
   */
  defaultTokenName: 'auth-token',

  /**
   * Password reset configuration.
   */
  passwordReset: {
    /**
     * Token expiration time in minutes.
     * After this time, the reset link becomes invalid.
     *
     * @default 60
     */
    expire: env.AUTH_PASSWORD_RESET_EXPIRE ||60,

    /**
     * Throttle time in seconds between password reset requests.
     * Users must wait this long before requesting another reset email.
     *
     * @default 60
     */
    throttle: env.AUTH_PASSWORD_RESET_THROTTLE ||60,
  },
} satisfies AuthConfig
