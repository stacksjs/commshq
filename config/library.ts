import type { LibraryConfig } from '@stacksjs/types'

/**
 * **Library Configuration**
 *
 * This configuration defines all of your library options. Because Stacks is fully-typed, you
 * may hover any of the options below and the definitions will be provided. In case you
 * have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  name: 'commshq',
  owner: '@stacksjs', // you may or may not add the @ prefix here (it is added automatically)
  repository: 'stacksjs/commshq',
  license: 'MIT',
  author: 'Chris Breuer',
  contributors: ['Chris Breuer <chris@stacksjs.com>'],
  defaultLanguage: 'en',
  releaseable: true,

  webComponents: {
    name: 'commshq-elements',
    description: 'Reusable CommsHQ workspace components.',
    keywords: ['communications', 'publishing', 'marketing', 'stx'],
    tags: [],
  },

  functions: {
    name: 'commshq-fx',
    description: 'The browser client for a CommsHQ workspace: signup forms, preference centres and unsubscribe links.',
    keywords: ['communications', 'publishing', 'marketing', 'newsletter', 'consent', 'typescript'],
    shouldGenerateSourcemap: false,
    /*
     * The modules, not the barrel. The build generates its own `index` from
     * this list and refuses to start when an entry claims that name -
     * `files: ['index']` collided with it, so the package could not be built
     * at all.
     */
    files: ['client', 'forms'],
  },
} satisfies LibraryConfig
