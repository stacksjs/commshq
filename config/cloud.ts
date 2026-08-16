import type { CloudConfig } from '@stacksjs/types'
import type { CloudConfig as TsCloudConfig } from '@stacksjs/ts-cloud'
import { env } from '@stacksjs/env'

const domain = env.APP_DOMAIN || 'commshq.org'

export const tsCloud: TsCloudConfig = {
  project: { name: 'commshq', slug: 'commshq', region: 'us-east-1' },
  stateDir: 'storage/cloud',
  cloud: { provider: 'hetzner', attachTo: 'stacks' },
  mode: 'server',
  environments: {
    production: {
      type: 'production',
      deployBranch: 'main',
      region: 'us-east-1',
      variables: {
        APP_ENV: 'production',
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        DB_CONNECTION: 'postgres',
        QUEUE_DRIVER: 'redis',
        CACHE_DRIVER: 'redis',
        QUEUE_PREFIX: 'commshq:queue',
        CACHE_PREFIX: 'commshq:cache',
        MAIL_MAILER: 'smtp',
      },
    },
  },
  infrastructure: {
    compute: {
      instances: 1,
      size: 'small',
      disk: { size: 20, type: 'ssd', encrypted: true },
      webServer: 'rpx',
      proxy: { engine: 'rpx', onDemandTls: true, onDemandTlsEmail: 'hello@commshq.org' },
      managedServices: { postgres: true, redis: true },
    },
    appDatabase: {
      engine: 'postgres',
      name: 'commshq',
      username: 'commshq',
      password: env.DB_PASSWORD,
      port: 5432,
    },
    ssl: {
      enabled: true,
      provider: 'letsencrypt',
      domains: [domain, `www.${domain}`, `mail.${domain}`],
      redirectHttp: true,
      letsEncrypt: { email: 'postmaster@commshq.org', staging: false, autoRenew: true },
    },
    dns: { domain },
    storage: {
      uploads: { public: false, encryption: true, versioning: true },
      assets: { public: true, encryption: true, versioning: true },
      logs: { public: false, encryption: true, versioning: false },
    },
    ai: {
      models: ['anthropic.claude-3-5-sonnet-20241022-v2:0'],
      allowStreaming: true,
      service: 'ec2',
    },
  },
  sites: {
    main: {
      root: '.',
      path: '/',
      domain,
      start: 'bun node_modules/@stacksjs/buddy/dist/serve-entry.js',
      port: 3030,
      framework: 'stacks',
      preStart: ['bun install --frozen-lockfile', 'bun node_modules/@stacksjs/buddy/dist/cli.js migrate'],
      queues: [
        { connection: 'redis', queue: 'campaigns,automations,mail,sms,commerce,default', processes: 2, timeout: 120, tries: 5, memory: 384, stopWaitSecs: 120 },
      ],
      scheduler: true,
      memoryHigh: '1G',
      memoryMax: '2G',
      env: { APP_ENV: 'production', NODE_ENV: 'production', API_URL: 'http://127.0.0.1:3031', PORT_API: '3031' },
    },
    api: {
      root: '.',
      start: 'bun node_modules/@stacksjs/actions/dist/serve/api.js',
      port: 3031,
      preStart: ['bun install --frozen-lockfile'],
      memoryHigh: '768M',
      memoryMax: '1536M',
      env: { HOST: '127.0.0.1', APP_ENV: 'production', NODE_ENV: 'production' },
    },
    www: { domain: `www.${domain}`, redirect: `https://${domain}` },
  },
}

const config: CloudConfig = {}
export default config
