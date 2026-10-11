import type { StxConfig } from '@stacksjs/stx'
import ui from './config/ui'

const config: Partial<StxConfig> = {
  root: 'resources',
  layoutsDir: 'views/layouts',
  // This root config takes precedence over config/ui.ts on the serve/build path.
  app: ui.app,
  /*
   * Forwarded for the same reason as `app`, and missing until now.
   *
   * Because this file wins on serve and build, a key it does not carry is a key
   * those paths never see. `plugins` was one, so @stacksjs/components never
   * loaded there: every <Badge> silently resolved to the framework's own
   * default instead, which ignores `className` and left the badge shortcuts in
   * config/crosswind.ts as dead code. A library-only tag such as <Breadcrumb>
   * did not resolve at all. config/ui.ts looked correct throughout, which is
   * what made it hard to see. Filed as stacksjs/stx#2056.
   */
  plugins: ui.plugins,
  build: {
    sitemapExclude: ['/dashboard/'],
  },
  site: {
    url: 'https://commshq.org',
  },
}

export default config
