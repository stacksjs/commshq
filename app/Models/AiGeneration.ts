import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AiGeneration',
  table: 'ai_generations',
  belongsTo: ['Team', 'User'],
  indexes: [{ name: 'ai_generations_team_created_index', columns: ['team_id', 'created_at'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'ai-generations', routes: ['index', 'show'], middleware: ['auth', 'team'] },
  },
  attributes: {
    purpose: { required: true, fillable: false, validation: { rule: schema.enum(['writing', 'segmentation', 'summary', 'optimization', 'recommendation']) }, factory: () => 'writing' },
    model: { required: true, fillable: false, validation: { rule: schema.string().max(255) }, factory: () => 'anthropic.claude-3-5-sonnet-20241022-v2:0' },
    promptHash: { required: true, fillable: false, validation: { rule: schema.string().max(128) }, factory: () => 'demo' },
    provenance: { required: true, fillable: false, validation: { rule: schema.json() }, factory: () => JSON.stringify({ provider: 'bedrock' }) },
    inputTokens: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    outputTokens: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    cost: { required: true, fillable: false, default: 0, validation: { rule: schema.number().min(0) }, factory: () => 0 },
    status: { required: true, fillable: false, default: 'draft', validation: { rule: schema.enum(['draft', 'approved', 'rejected', 'published']) }, factory: () => 'draft' },
    approvedBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
    approvedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
  },
} as const)
