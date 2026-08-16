import type { CacheConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

/**
 * **Cache Configuration**
 *
 * This configuration defines all of your cache options. Stacks cache is
 * powered by ts-cache, providing high-performance caching with support
 * for memory and Redis drivers.
 */
export default {
  /**
   * The cache driver to use ('memory' or 'redis')
   */
  driver: (env.CACHE_DRIVER || 'memory') as 'memory' | 'redis',

  /**
   * Key prefix for cache namespacing
   */
  prefix: String(env.CACHE_PREFIX || 'commshq:cache'),

  /**
   * Default TTL in seconds (0 = no expiration)
   */
  ttl: 3600,

  /**
   * Maximum number of keys (-1 = unlimited)
   */
  maxKeys: -1,

  /**
   * Clone values on get/set (disable for better performance with immutable data)
   */
  useClones: true,

  drivers: {
    /**
     * Memory driver configuration
     */
    memory: {
      maxKeys: -1,
      checkPeriod: 600,
      deleteOnExpire: true,
    },

    /**
     * Redis driver configuration
     */
    redis: {
      host: String(env.REDIS_HOST || '127.0.0.1'),
      port: Number(env.REDIS_PORT || 6379),
      username: String(env.REDIS_USERNAME || ''),
      password: String(env.REDIS_PASSWORD || ''),
      database: Number(env.REDIS_DB || 0),
      tls: Boolean(env.REDIS_TLS || false),
    },

    /**
     * SingleStore driver configuration
     *
     * Persists cache entries in a SingleStore rowstore table (MySQL wire
     * protocol, port 3306). Set `ssl: true` for managed SingleStore (Helios).
     */
    singlestore: {
      host: '127.0.0.1',
      port: 3306,
      username: 'root',
      password: '',
      database: 'stacks',
      table: 'stacks_cache',
      ssl: false,
    },
  },
} satisfies CacheConfig
