import type { StxOptions as UiOptions } from '@stacksjs/stx'

/**
 * STX Configuration for Stacks
 * Note: Dashboard mode overrides these settings via serve() options
 */

export default {
  // Pin template topology to the application resources directory. This keeps
  // component, layout and partial resolution stable for CLI, dev and build
  // processes instead of asking each process to infer the same root.
  root: 'resources',

  // Where stx keeps everything it generates: the compiled-template cache, the
  // Crosswind CSS cache, client-script bundles, the route manifest and route
  // types. Stacks keeps every runtime-owned directory under storage/ rather
  // than a `.stx` in the project root - see `stxPath()` in @stacksjs/path,
  // which also exports this as STX_DIR for processes that never read a config.
  stateDir: 'storage/framework/stx',

  // Components, layouts and partials directories.
  //
  // These are resolved RELATIVE TO the explicit `resources` stx root.
  // Spelling them `resources/components` here made stx join the
  // root on a second time and look in `resources/resources/components`, so
  // `<Card />` in a template resolved to nothing and stx warned on every boot.
  componentsDir: 'components',

  // Expose @stacksjs/components' ui library (<Sidebar>, <Button>, ...)
  // to tag resolution everywhere — the dashboard's macOS-style sidebar
  // resolves through this. See the plugin file for the lookup order.
  plugins: ['./storage/framework/defaults/stx-components-plugin.ts'],

  layoutsDir: 'views/layouts',

  partialsDir: 'partials',

  /*
   * stx's client-script DOM guard: 25 rules at script-validation.js:1-127,
   * run by process.js on every non-server <script> body. serve.js forwards the
   * key only when it is literally present (`..."strict" in stxConfig`), so an
   * absent key means every violation is collected and then silently dropped,
   * which is how this app accumulated them unseen.
   *
   * Warning-first, matching bughq, loghq, statushq and analyticshq: the
   * warnings are the migration queue rather than a build break. Ratchet
   * failOnViolation to true once the queue is empty.
   *
   * allowPatterns stays EMPTY. The filter is a substring match on the rule's
   * message or pattern source and is rule-global with no way to scope it to one
   * call site, so a single entry can silently disable several rules at once.
   */
  strict: {
    enabled: true,
    failOnViolation: false,
    allowPatterns: [],
  },

  // Whether this app serves the framework's default views: the auth pages
  // (/login, /register, /forgot-password, /password/reset/:token,
  // /auth/magic/:token), a demo storefront (/cart, /checkout/*, /orders/:id),
  // the error pages and the mail previews. Left unset, each page is served
  // only while the route bundle it posts to is mounted (STACKS_DEFAULT_ROUTES):
  // the auth pages with `auth`, the storefront with `dashboard`. `true` serves
  // all of them whatever is mounted; `false` serves only `resources/views`; an
  // array names the subtrees to keep, e.g. `['errors', 'emails']`. Applies to
  // `buddy dev` and `buddy serve` alike, and to the sitemap.
  // defaultViews: true,
// `plugins` landed in stx after the pinned @stacksjs/stx types — widen until the dep updates.
} satisfies UiOptions & { plugins?: string[], defaultViews?: boolean | string[] }
