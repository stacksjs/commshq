/**
 * Dependency updates, run by Buddy (@buddysh/buddy) from
 * .github/workflows/buddy-bot.yml.
 *
 * No type import: the bot is run with `bunx` rather than installed (its
 * commands share the Stacks CLI's names, see the workflow), so its types are
 * not in node_modules. `buddy upgrade` also rewrites a buddy-bot type import
 * to @buddysh/buddy, which then fails typecheck; with no import there is
 * nothing for it to rewrite.
 */
export default {
  repository: {
    owner: 'stacksjs',
    name: 'commshq',
    provider: 'github',
    // token: process.env.BUDDY_BOT_TOKEN,
  },
  dashboard: {
    enabled: true,
    title: 'Dependency Dashboard',
    // issueNumber: undefined, // Auto-generated
  },
  workflows: {
    enabled: true,
    outputDir: '.github/workflows',
    templates: {
      daily: true,
      weekly: true,
      monthly: true,
    },
    custom: [],
  },
  packages: {
    strategy: 'all',
    ignore: [
      // Add packages to ignore here
      // Example: '@types/node', 'eslint'
    ],
    ignorePaths: [
      'storage/framework/**',
    ],
  },
  verbose: false,
}
