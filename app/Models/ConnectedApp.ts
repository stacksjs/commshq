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
    // Set when the app's mail bounced or drew complaints past what CommsHQ's
    // shared addresses can carry (app/Hq/standing.ts). Cleared by a person.
    sendingPausedAt: { required: false, fillable: false, validation: { rule: schema.timestamp() }, factory: () => null },
    sendingPausedReason: { required: false, fillable: false, validation: { rule: schema.string().max(500) }, factory: () => null },
    // The address on its own domain the app last sent from. Mail CommsHQ
    // writes for the app, a signup confirmation, is from it too.
    fromAddress: { required: false, fillable: false, validation: { rule: schema.string().max(254) }, factory: () => null },
    createdBy: { required: false, fillable: false, validation: { rule: schema.number().min(1) }, factory: () => null },
  },
  dashboard: { highlight: true, section: 'management', icon: 'i-hugeicons-plug-01' },
} as const)
