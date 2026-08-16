import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'FormDefinition', table: 'form_definitions', belongsTo: ['Team', 'Site', 'Audience'], hasMany: ['FormSubmission'],
  indexes: [{ name: 'form_definitions_team_slug_unique', columns: ['team_id', 'slug'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, observe: true, useApi: { prefix: 'v1', uri: 'forms', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(160) } },
    slug: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(120).matches(/^[a-z0-9-]+$/) } },
    kind: { required: true, fillable: true, default: 'inline', validation: { rule: schema.enum(['inline', 'popup', 'landing_page', 'gated_resource']) } },
    schemaDocument: { required: true, fillable: true, validation: { rule: schema.json() } },
    doubleOptIn: { required: true, fillable: true, default: true, validation: { rule: schema.boolean() } },
    status: { required: true, fillable: true, default: 'draft', validation: { rule: schema.enum(['draft', 'active', 'archived']) } },
  },
  dashboard: { highlight: true, section: 'marketing', icon: 'i-hugeicons-left-to-right-list-bullet' },
} as const)
