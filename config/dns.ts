import type { DnsConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

/**
 * Additional DNS records owned by this application.
 *
 * Server records are derived from config/cloud.ts during deployment. Add
 * provider and zone details there before asking Buddy to reconcile DNS.
 */
export default {
  a: [],
  aaaa: [],
  cname: [{ name: 'www.commshq.org', target: 'commshq.org', ttl: 300 }],
  mx: [{ name: 'commshq.org', mailServer: 'mail.commshq.org', priority: 10, ttl: 300 }],
  txt: [
    { name: 'commshq.org', content: 'v=spf1 mx -all', ttl: 300 },
    { name: '_dmarc.commshq.org', content: 'v=DMARC1; p=reject; rua=mailto:postmaster@commshq.org; adkim=s; aspf=s', ttl: 300 },
    ...(env.MAIL_DKIM_PUBLIC_KEY ? [{ name: 'mail._domainkey.commshq.org', content: String(env.MAIL_DKIM_PUBLIC_KEY), ttl: 300 }] : []),
  ],
  nameservers: [],
} satisfies DnsConfig
