import type { EmailConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

export default {
  from: {
    name: env.MAIL_FROM_NAME || 'CommsHQ',
    address: env.MAIL_FROM_ADDRESS || 'hello@commshq.org',
  },

  domain: env.MAIL_DOMAIN || env.APP_DOMAIN || 'commshq.org',
  mailboxes: ['hello', 'support', 'billing', 'abuse', 'postmaster', 'no-reply'],
  forwards: {},
  url: env.APP_URL || 'https://commshq.org',
  charset: 'UTF-8',

  server: {
    enabled: true,
    scan: true,
    subdomain: 'mail',
    mode: 'server',
  },
} satisfies EmailConfig
