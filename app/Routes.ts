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
  public: { path: 'public', prefix: '' },
} satisfies RouteRegistry
