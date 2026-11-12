import type { SecurityConfig } from '@stacksjs/types'

/**
 * **Services**
 *
 * This configuration defines all of your services. Because Stacks is fully-typed, you may
 * hover any of the options below and the definitions will be provided. In case you
 * have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  firewall: {
    enabled: true,
    countryCodes: ['RU', 'IR'],
    ipAddresses: [],
    // Per-IP request ceiling. Kept low enough to blunt online brute force /
    // enumeration against auth, password-reset, and 2FA endpoints (the
    // per-account lockouts are the second line; this is the first). Raise it
    // for high-throughput public APIs — but 1000/min/IP let an attacker make
    // ~16 guesses/sec, which defeats the purpose of a firewall limit.
    rateLimitPerMinute: 100,
    useIpReputationLists: true,
    useKnownBadInputsRuleSet: true,
    queryString: [],
    httpHeaders: [],
  },

  api: {
    // The app's own models, plus two of the framework's. Generated APIs
    // default to `own`, so `Campaign` and `Automation`, which this app runs
    // (`DispatchCampaignAction`, the `DispatchCampaign` and
    // `ProcessAutomationRun` jobs) but does not define, had no list or create
    // endpoint and their pages had nothing to read. Both carry `team_id`, so
    // their routes are scoped to the caller's active team like every model
    // in `app/Models`.
    models: ['own', 'Campaign', 'Automation'],
  },
} satisfies SecurityConfig
