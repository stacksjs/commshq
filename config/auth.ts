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
   * in" checkbox overrides it per-login to 30 days - see the `browserSession`
   * block below, which is where that tier now lives. There is no short-access +
   * refresh-rotation split any more: the cookie is the session.
   */
  tokenExpiry: env.AUTH_TOKEN_EXPIRY || 7 * 24 * 60 * 60 * 1000,

  /**
   * Browser session policy, in milliseconds.
   *
   * The framework issues browser sessions from these two lifetimes, so an app
   * no longer has to hand-roll LoginAction to get a tier.
   * `resolveBrowserSessionPolicy(remember)` picks `rememberedLifetime` when the
   * login form's "keep me signed in" box is checked and `baselineLifetime`
   * otherwise, then stamps BOTH the `oauth_access_tokens.expires_at` row and
   * the cookie's Max-Age from that one number - so the whole session honours
   * the tier, not just the cookie.
   *
   * `rememberedLifetime` is set explicitly because it DEFAULTS TO
   * `baselineLifetime` when omitted: leaving it out would silently collapse
   * "keep me signed in for 30 days" to 7 days, with no error and nothing else
   * failing. tests/Unit/BrowserSession.test.ts fails if that ever regresses.
   */
  browserSession: {
    baselineLifetime: 7 * 24 * 60 * 60 * 1000,
    rememberedLifetime: 30 * 24 * 60 * 60 * 1000,

    // Left true to preserve the current response shape - a refresh_token still
    // appears in the login, register and 2FA bodies. Turning it off also
    // strands the /auth/refresh route the defaults bundle still mounts, so it
    // belongs in its own change.
    withRefreshToken: true,

    // logoutRedirect deliberately unset: nothing under resources/ posts to
    // /logout, so there is no HTML logout navigation to redirect. Setting it
    // would invent behaviour rather than preserve it.
  },

  /**
   * Auth cookie attributes.
   *
   * `secure` is set explicitly rather than left to inference. The framework's
   * `shouldSecureAuthCookie()` decides from `config.app.url`, and config/app.ts
   * falls back to `commshq.localhost` - a loopback host, so the flag would be
   * DROPPED if APP_URL were ever absent or failed to decrypt, shipping a
   * 7-to-30 day session token in the clear with nothing to notice it.
   *
   * The predicate below is a like-for-like port of the one the app's own cookie
   * helper has always used: secure everywhere except a local environment.
   */
  cookie: {
    name: 'auth-token',
    path: '/',
    sameSite: 'Lax',
    secure: !['', 'local', 'development', 'dev', 'test', 'testing']
      .includes(String(env.APP_ENV ?? '').toLowerCase()),
  },

  /**
   * Refresh-token expiry in milliseconds. NOT WIRED UP: a refresh token is
   * still minted and returned in the OAuth2 payload, but nothing in this app
   * consumes it. The framework defaults bundle does still mount an
   * /auth/refresh route, so the old claim that none exists was wrong. The
   * session ends when the browserSession lifetime elapses. Kept for the
   * payload shape; see browserSession.withRefreshToken to stop issuing one.
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
