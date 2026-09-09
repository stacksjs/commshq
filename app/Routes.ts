/**
 * Route Registry
 *
 * This file re-exports the default route registry.
 * Customize this file to add your own route files.
 *
 * @see https://docs.stacksjs.org/routing
 */

import type { RouteRegistry } from '@stacksjs/router'
import frameworkRoutes from '../storage/framework/defaults/app/Routes'

export * from '../storage/framework/defaults/app/Routes'

export default {
  ...frameworkRoutes,
  // `prefix: ''` mounts these at the document root. Without an entry here the
  // file is never loaded at all: a route file is only read if the registry
  // names it, so `routes/auth.ts` sat on disk doing nothing and the framework's
  // own CSRF-gated /login and /register answered instead. That failed as "CSRF
  // token mismatch" on the sign-in form, which reads like a token bug rather
  // than a file nobody loaded.
  auth: { path: 'auth', prefix: '' },
  public: { path: 'public', prefix: '' },
} satisfies RouteRegistry
