import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AiGeneration',
  table: 'ai_generations',
  belongsTo: ['Team', 'User'],
  indexes: [
    { name: 'ai_generations_team_created_index', columns: ['team_id', 'created_at'] },
    { name: 'ai_generations_team_idempotency_unique', columns: ['team_id', 'idempotency_key'], unique: true },
  ],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'ai-generations', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    purpose: { required: true, fillable: false, validation: { rule: schema.enum(['writing', 'segmentation', 'summary', 'optimization', 'recommendation']) }, factory: () => 'writing' },
    idempotencyKey: { required: true, fillable: false, guarded: true, validation: { rule: schema.string().max(128) }, factory: faker => faker.string.uuid() },
    model: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: () => 'anthropic.claude-3-5-sonnet-20241022-v2:0' },
    promptHash: { required: true, fillable: false, validation: { rule: schema.string().max(128) }, factory: () => 'demo' },
    provenance: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({ provider: 'bedrock' }) },
    output: { type: 'text', required: true, fillable: false, guarded: true, validation: { rule: schema.string().max(100_000) }, factory: () => 'Review-ready draft.' },
    inputTokens: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    outputTokens: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    cost: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    status: { required: true, fillable: false, default: 'draft', validation: { rule: schema.enum(['generating', 'draft', 'approved', 'rejected', 'published', 'failed']) }, factory: () => 'draft' },
    failureReason: { required: false, fillable: false, validation: { rule: schema.string().max(120) }, factory: () => null },
    approvedBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
    approvedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
