import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'AutomationVersion', table: 'automation_versions', belongsTo: ['Team', 'Automation'],
  indexes: [{ name: 'automation_versions_unique', columns: ['automation_id', 'version'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'automation-versions', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    version: { required: true, fillable: false, validation: { rule: schema.number().min(1) } },
    graph: { required: true, fillable: false, validation: { rule: schema.json() } },
    checksum: { required: true, fillable: false, validation: { rule: schema.string().max(128) } },
    publishedBy: { required: true, fillable: false, validation: { rule: schema.number().min(1) } },
    publishedAt: { required: true, fillable: false, validation: { rule: schema.timestamp() } },
  },
  dashboard: { section: 'marketing', icon: 'i-hugeicons-git-branch' },
} as const)
