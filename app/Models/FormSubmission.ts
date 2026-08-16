import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'FormSubmission', table: 'form_submissions', belongsTo: ['Team', 'FormDefinition', 'Contact'],
  indexes: [{ name: 'form_submissions_team_created', columns: ['team_id', 'created_at'] }, { name: 'form_submissions_dedupe_unique', columns: ['form_definition_id', 'dedupe_key'], unique: true }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'form-submissions', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    payload: { required: true, fillable: true, validation: { rule: schema.json() } },
    dedupeKey: { required: true, fillable: true, validation: { rule: schema.string().max(128) } },
    sourceUrl: { required: false, fillable: true, validation: { rule: schema.string().max(2048) } },
    ipHash: { required: false, fillable: false, hidden: true, validation: { rule: schema.string().max(128) } },
    status: { required: true, fillable: true, default: 'accepted', validation: { rule: schema.enum(['accepted', 'confirmed', 'rejected', 'spam']) } },
  },
  dashboard: { section: 'marketing', icon: 'i-hugeicons-inbox-check' },
} as const)
