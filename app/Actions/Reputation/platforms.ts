export const REPUTATION_PLATFORMS = [
  'google_business',
  'yelp',
  'facebook',
  'instagram',
  'x',
  'tiktok',
  'linkedin',
  'youtube',
  'trustpilot',
  'reddit',
] as const

export type ReputationPlatform = typeof REPUTATION_PLATFORMS[number]

/** Platforms that describe a physical or claimed business listing rather than a social handle. */
export const BUSINESS_LISTING_PLATFORMS: readonly ReputationPlatform[] = ['google_business', 'yelp', 'trustpilot']

export type MentionKind = 'review' | 'comment' | 'mention' | 'question'
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown'

export function parsePlatform(value: unknown): ReputationPlatform | null {
  const platform = String(value || '').toLowerCase()
  return REPUTATION_PLATFORMS.includes(platform as ReputationPlatform) ? platform as ReputationPlatform : null
}

export function profileKindFor(platform: ReputationPlatform): 'business_listing' | 'social_handle' {
  return BUSINESS_LISTING_PLATFORMS.includes(platform) ? 'business_listing' : 'social_handle'
}
