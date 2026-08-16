import type { DashboardConfig } from '@stacksjs/types'

/**
 * **Dashboard Configuration**
 *
 * Controls which sections render in the `buddy dev --dashboard` sidebar.
 * Each section defaults to enabled — flip a flag to `false` here to hide
 * a section that this project doesn't use.
 *
 * Common cases:
 *
 *   • A non-commerce app removes the Commerce section (and its categorized
 *     model rows) by setting `commerce.enabled: false`.
 *
 *   • A project with no newsletter hides the built-in Subscribers row in
 *     the Data section by setting `data.subscribers.enabled: false`. The
 *     Data section itself stays — that's where every userland model under
 *     `app/Models/` is auto-listed, and you always want to see those.
 */
export default {
  enabled: true,

  nav: [
    {
      title: 'Workspace',
      items: [
        { label: 'Command center', href: '/commshq', icon: 'i-hugeicons-dashboard-square-02' },
        { label: 'Onboarding', href: '/commshq/onboarding', icon: 'i-hugeicons-rocket-02' },
        { label: 'Audience', href: '/commshq/audience', icon: 'i-hugeicons-user-multiple-02' },
        { label: 'Segments', href: '/commshq/segments', icon: 'i-hugeicons-filter-horizontal' },
        { label: 'Campaigns', href: '/commshq/campaigns', icon: 'i-hugeicons-mail-send-02' },
        { label: 'Message studio', href: '/commshq/editor', icon: 'i-hugeicons-edit-02' },
        { label: 'Automations', href: '/commshq/automations', icon: 'i-hugeicons-workflow-square-06' },
      ],
    },
    {
      title: 'Publish and sell',
      items: [
        { label: 'Publications', href: '/commshq/publications', icon: 'i-hugeicons-news-01' },
        { label: 'Sites', href: '/commshq/sites', icon: 'i-hugeicons-web-design-02' },
        { label: 'Forms', href: '/commshq/forms', icon: 'i-hugeicons-note-add' },
        { label: 'Commerce', href: '/commshq/commerce', icon: 'i-hugeicons-shopping-bag-02' },
        { label: 'Monetization', href: '/commshq/monetization', icon: 'i-hugeicons-money-receive-circle' },
        { label: 'Analytics', href: '/commshq/analytics', icon: 'i-hugeicons-chart-line-data-02' },
      ],
    },
    {
      title: 'Deliverability',
      items: [
        { label: 'Domains', href: '/commshq/domains', icon: 'i-hugeicons-global' },
        { label: 'Senders', href: '/commshq/senders', icon: 'i-hugeicons-mail-validation-01' },
        { label: 'Integrations', href: '/commshq/integrations', icon: 'i-hugeicons-plug-socket' },
        { label: 'Billing and usage', href: '/commshq/billing', icon: 'i-hugeicons-credit-card' },
        { label: 'Team and access', href: '/commshq/teams', icon: 'i-hugeicons-shield-user' },
        { label: 'Settings', href: '/commshq/settings', icon: 'i-hugeicons-settings-02' },
      ],
    },
  ],

  sections: {
    library: { enabled: true },
    content: { enabled: true },
    commerce: { enabled: true },
    marketing: { enabled: true },
    analytics: { enabled: true },
    management: { enabled: true },
    utilities: { enabled: true },
    data: {
      // Basic built-in rows. Disable any you don't need; your userland
      // models in `app/Models/` always appear regardless of these flags.
      dashboard: { enabled: true },
      activity: { enabled: true },
      users: { enabled: true },
      teams: { enabled: true },
      subscribers: { enabled: true },
      allModels: { enabled: true },
    },
  },

  // CI tracking — ports the standalone repo-dashboard into the dashboard
  // (stacksjs/stacks#1844). Off by default; opt in by listing orgs and
  // setting GITHUB_TOKEN in .env.
  ci: {
    enabled: false,
    orgs: [],
    runnerCapDefault: 20,
    // Failing-CI notifications (stacksjs/stacks#1849). Off by default;
    // turn on to get pinged every time main goes red. Defaults to the
    // `chat` channel (Slack via webhook) so projects that have no
    // explicit recipient list still get notifications out of the box.
    notifications: {
      enabled: false,
      channels: ['chat'],
      cooldownMinutes: 5,
    },
    // Runner-pressure alerts (stacksjs/stacks#1850). Fires when an
    // org's queue depth stays at or above `queuedThreshold` for a
    // full `windowMinutes` of dashboard refreshes. Hysteresis means a
    // sustained-pressure alert clears only after queue drops below
    // threshold for another full window before re-firing.
    alerts: {
      enabled: false,
      queuedThreshold: 8,
      windowMinutes: 10,
      channels: ['chat'],
      retentionHours: 24,
    },
  },
} satisfies DashboardConfig
