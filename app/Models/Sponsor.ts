import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Sponsor', table: 'sponsors', belongsTo: ['Team'], hasMany: ['AdvertiserOffer'],
  indexes: [{ name: 'sponsors_team_name', columns: ['team_id', 'name'] }],
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'sponsors', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] } },
  attributes: {
    name: { required: true, fillable: true, validation: { rule: schema.string().min(2).max(180) } },
    contactEmail: { required: true, fillable: true, validation: { rule: schema.string().email().max(255) } },
    website: { required: false, fillable: true, validation: { rule: schema.string().max(2048) } },
    status: { required: true, fillable: true, default: 'prospect', validation: { rule: schema.enum(['prospect', 'active', 'paused', 'blocked']) } },
    notes: { required: false, fillable: true, validation: { rule: schema.string().max(4000) } },
  },
  dashboard: { highlight: true, section: 'marketing', icon: 'i-hugeicons-megaphone-02' },
} as const)
