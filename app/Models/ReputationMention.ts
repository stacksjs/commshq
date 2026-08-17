import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ReputationMention',
  table: 'reputation_mentions',
  belongsTo: ['Team', 'MonitoredProfile'],
  indexes: [
    { name: 'reputation_mentions_profile_external_unique', columns: ['monitored_profile_id', 'external_id'], unique: true },
    { name: 'reputation_mentions_team_posted_index', columns: ['team_id', 'posted_at'] },
    { name: 'reputation_mentions_team_sentiment_index', columns: ['team_id', 'sentiment', 'posted_at'] },
  ],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'reputation-mentions', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    platform: { required: true, fillable: false, validation: { rule: schema.enum(['google_business', 'yelp', 'facebook', 'instagram', 'x', 'tiktok', 'linkedin', 'youtube', 'trustpilot', 'reddit']) }, factory: () => 'google_business' },
    kind: { required: true, fillable: false, validation: { rule: schema.enum(['review', 'comment', 'mention', 'question']) }, factory: () => 'review' },
    externalId: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: faker => faker.string.alphanumeric(24) },
    authorName: { required: false, fillable: false, validation: { rule: schema.string().max(160) }, factory: () => null },
    authorHandle: { required: false, fillable: false, validation: { rule: schema.string().max(160) }, factory: () => null },
    body: { type: 'text', required: true, fillable: false, validation: { rule: schema.string().max(20_000) }, factory: faker => faker.lorem.sentences(2) },
    rating: { required: false, fillable: false, validation: { rule: schema.number().min(1).max(5) }, factory: () => null },
    sentiment: { required: true, fillable: false, default: 'unknown', validation: { rule: schema.enum(['positive', 'neutral', 'negative', 'unknown']) }, factory: () => 'neutral' },
    sentimentScore: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(-100).max(100) }, factory: () => 0 },
    language: { required: false, fillable: false, validation: { rule: schema.string().max(12) }, factory: () => null },
    url: { required: false, fillable: false, validation: { rule: schema.string().max(500) }, factory: () => null },
    status: { required: true, fillable: false, default: 'new', validation: { rule: schema.enum(['new', 'triaged', 'responded', 'ignored']) }, factory: () => 'new' },
    respondedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    respondedBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
    raw: { type: 'text', required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    postedAt: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
    fetchedAt: { required: true, fillable: false, validation: { rule: schema.timestamp() }, factory: () => new Date().toISOString() },
  },
} as const)
