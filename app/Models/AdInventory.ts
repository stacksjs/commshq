import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AdInventory',
  table: 'ad_inventory',
  belongsTo: ['Team', 'Publication'],
  hasMany: ['AdPlacement'],
  indexes: [{ name: 'ad_inventory_team_publication_index', columns: ['team_id', 'publication_id', 'status'] }],
  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: { prefix: 'v1', uri: 'ad-inventory', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
  },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().max(160) }, factory: () => 'Primary newsletter slot' },
    format: { required: true, fillable: true, validation: { rule: schema.enum(['newsletter', 'web', 'podcast', 'recommendation']) }, factory: () => 'newsletter' },
    position: { required: true, fillable: true, validation: { rule: schema.string().max(100) }, factory: () => 'mid_content' },
    rate: { required: true, fillable: true, validation: { rule: schema.number().min(0) }, factory: () => 50000 },
    currency: { required: true, fillable: true, default: 'usd', validation: { rule: schema.string().max(3) }, factory: () => 'usd' },
    capacity: { required: true, fillable: true, default: 1, validation: { rule: schema.number().min(1) }, factory: () => 1 },
    status: { required: true, fillable: true, default: 'active', validation: { rule: schema.enum(['active', 'paused', 'sold_out', 'archived']) }, factory: () => 'active' },
  },
} as const)
