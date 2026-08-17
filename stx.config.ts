import type { StxConfig } from '@stacksjs/stx'

const config: Partial<StxConfig> = {
  root: 'resources',
  build: {
    sitemapExclude: ['/dashboard/'],
  },
  site: {
    url: 'https://commshq.org',
  },
}

export default config
