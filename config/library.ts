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
    description: 'CommsHQ browser functions.',
    keywords: ['communications', 'publishing', 'marketing', 'typescript'],
    shouldGenerateSourcemap: false,
    files: ['index'],
  },
} satisfies LibraryConfig
