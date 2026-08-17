import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'MonitoredProfile',
  table: 'monitored_profiles',
  belongsTo: ['Team', 'IntegrationCredential'],
  indexes: [
    { name: 'monitored_profiles_team_platform_external_unique', columns: ['team_id', 'platform', 'external_id'], unique: true },
    { name: 'monitored_profiles_due_index', columns: ['status', 'next_poll_at'] },
  ],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'monitored-profiles', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    platform: { required: true, fillable: false, validation: { rule: schema.enum(['google_business', 'yelp', 'facebook', 'instagram', 'x', 'tiktok', 'linkedin', 'youtube', 'trustpilot', 'reddit']) }, factory: () => 'google_business' },
    kind: { required: true, fillable: false, validation: { rule: schema.enum(['business_listing', 'social_handle']) }, factory: () => 'business_listing' },
    displayName: { required: true, fillable: false, validation: { rule: schema.string().max(160) }, factory: faker => faker.company.name() },
    handle: { required: false, fillable: false, validation: { rule: schema.string().max(160) }, factory: () => null },
    externalId: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: faker => faker.string.alphanumeric(18) },
    locationLabel: { required: false, fillable: false, validation: { rule: schema.string().max(200) }, factory: () => null },
    profileUrl: { required: false, fillable: false, validation: { rule: schema.string().max(500) }, factory: () => null },
    status: { required: true, fillable: false, default: 'unconfigured', validation: { rule: schema.enum(['active', 'paused', 'unconfigured', 'error']) }, factory: () => 'unconfigured' },
    pollIntervalMinutes: { required: true, fillable: false, default: 30, validation: { rule: schema.number().min(5).max(1_440) }, factory: () => 30 },
    nextPollAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    lastPolledAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    lastMentionAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    cursor: { required: false, fillable: false, validation: { rule: schema.string().max(500) }, factory: () => null },
    consecutiveFailures: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    lastError: { required: false, fillable: false, validation: { rule: schema.string().max(500) }, factory: () => null },
  },
} as const)
