import type { BunPressOptions } from '@stacksjs/bunpress'

const config: BunPressOptions = {
  verbose: false,
  docsDir: './docs',
  outDir: './dist/docs',

  nav: [
    { text: 'Quick start', link: '/getting-started' },
    { text: 'Audience', link: '/audience/contacts-consent' },
    { text: 'Campaigns', link: '/campaigns/email-sms' },
    { text: 'Developers', link: '/developers/api' },
    { text: 'GitHub', link: 'https://github.com/stacksjs/commshq' },
  ],

  markdown: {
    title: 'CommsHQ Documentation',
    meta: {
      description: 'Audience, campaigns, publishing, automations, commerce, reputation, and developer documentation.',
      author: 'CommsHQ',
    },
    syntaxHighlightTheme: 'github-dark',
    toc: { enabled: true, minDepth: 2, maxDepth: 3 },
    sidebar: {
      '/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is CommsHQ', link: '/introduction' },
            { text: 'Quick start', link: '/getting-started' },
          ],
        },
        {
          text: 'Audience',
          items: [
            { text: 'Contacts and consent', link: '/audience/contacts-consent' },
            { text: 'Segments and imports', link: '/audience/segments-imports' },
          ],
        },
        {
          text: 'Campaigns',
          items: [
            { text: 'Email and SMS', link: '/campaigns/email-sms' },
            { text: 'Experiments and delivery', link: '/campaigns/experiments-delivery' },
          ],
        },
        {
          text: 'Publishing',
          items: [
            { text: 'Publications and pages', link: '/publishing/publications-pages' },
            { text: 'Forms and gated resources', link: '/publishing/forms-resources' },
            { text: 'Podcasts and feeds', link: '/publishing/podcasts-feeds' },
          ],
        },
        {
          text: 'Automation and AI',
          items: [
            { text: 'Versioned journeys', link: '/automation/journeys' },
            { text: 'AI drafts and approvals', link: '/automation/ai-drafts' },
          ],
        },
        {
          text: 'Commerce',
          items: [
            { text: 'Events and attribution', link: '/commerce/events-attribution' },
            { text: 'Recovery and monetization', link: '/commerce/recovery-monetization' },
          ],
        },
        {
          text: 'Reputation',
          items: [
            { text: 'Monitoring and triage', link: '/reputation/monitoring' },
          ],
        },
        {
          text: 'Developers',
          items: [
            { text: 'API', link: '/developers/api' },
            { text: 'Webhooks', link: '/developers/webhooks' },
          ],
        },
        {
          text: 'Operate',
          items: [
            { text: 'Security and compliance', link: '/operate/security-compliance' },
            { text: 'Self-hosting and CLI', link: '/operate/self-hosting-cli' },
          ],
        },
      ],
    },
  },

  themeConfig: {
    darkMode: 'auto',
    footer: {
      message: 'Creator-first communications infrastructure, released under the MIT License.',
      copyright: 'Copyright 2026-present CommsHQ',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/stacksjs/commshq' }],
  },

  sitemap: { enabled: true, baseUrl: 'https://commshq.org/docs' },
  robots: { enabled: true },
}

export default config
