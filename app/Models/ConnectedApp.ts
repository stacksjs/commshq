import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ConnectedApp', table: 'connected_apps', belongsTo: ['Team', 'SenderDomain'],
  // One app of a name per workspace, whatever its case: `name_key` is the name lower-cased.
  indexes: [{ name: 'connected_apps_team_name_unique', columns: ['team_id', 'name_key'], unique: true }],
  // Read-only here. An app is made by approving `buddy hq:connect commshq`
  // (app/Hq, routes/hq.ts), never by a request body.
  traits: { useUuid: true, useTimestamps: true, useApi: { prefix: 'v1', uri: 'connected-apps', routes: ['index', 'show'], middleware: ['auth', 'team'] } },
  attributes: {
    name: { required: true, fillable: false, validation: { rule: schema.string().max(64) }, factory: () => 'My app' },
    nameKey: { required: true, fillable: false, validation: { rule: schema.string().max(64) }, factory: () => 'my app' },
    createdBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
  },
  dashboard: { highlight: true, section: 'management', icon: 'i-hugeicons-plug-01' },
} as const)
