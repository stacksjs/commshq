import type { StxConfig } from '@stacksjs/stx'
import ui from './config/ui'

const config: Partial<StxConfig> = {
  root: 'resources',
  layoutsDir: 'views/layouts',
  // This root config takes precedence over config/ui.ts on the serve/build path.
  app: ui.app,
  build: {
    sitemapExclude: ['/dashboard/'],
  },
  site: {
    url: 'https://commshq.org',
  },
}

export default config
