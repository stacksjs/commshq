import { route } from '@stacksjs/router'

/**
 * This file is the entry point for your application's API routes.
 * The routes defined here are automatically registered. Last but
 * not least, you may also create any other `routes/*.ts` files.
 *
 * Every route in this file is mounted under `/api`. The prefix comes from
 * the `'api'` key in `app/Routes.ts` and lines up with the path the dev
 * proxy forwards (`/api/*`), so `route.get('/hello', ...)` below answers
 * `GET /api/hello`. Paths at the document root belong in a route file
 * whose registry entry sets `prefix: ''`.
 *
 * Framework routes (auth, dashboard, commerce, CMS, etc.) are loaded
 * automatically from storage/framework/defaults/routes/dashboard.ts.
 * You do NOT need to define them here — only add your own custom routes.
 *
 * @see https://docs.stacksjs.com/routing
 */

// Your custom routes go here. This one answers `GET /api/hello`:
route.get('/v1/workspace', 'Actions/Api/V1/WorkspaceSummaryAction').middleware('auth').middleware('team')
route.post('/v1/campaigns/{id}/dispatch', 'Actions/Api/V1/DispatchCampaignAction').middleware('auth').middleware('team').rateLimit(20, 'minute')
route.post('/v1/ai/generate', 'Actions/Api/V1/GenerateAiDraftAction').middleware('auth').middleware('team').rateLimit(10, 'minute')
route.post('/v1/ai-generations/{id}/decision', 'Actions/Api/V1/DecideAiDraftAction').middleware('auth').middleware('team').rateLimit(30, 'minute')

route.post('/v1/monitored-profiles', 'Actions/Api/V1/Reputation/CreateMonitoredProfileAction').middleware('auth').middleware('team').rateLimit(20, 'minute')
route.post('/v1/reputation-alert-rules', 'Actions/Api/V1/Reputation/UpsertAlertRuleAction').middleware('auth').middleware('team').rateLimit(20, 'minute')
route.post('/v1/reputation-alerts/{id}/decision', 'Actions/Api/V1/Reputation/AcknowledgeAlertAction').middleware('auth').middleware('team').rateLimit(60, 'minute')
route.post('/v1/reputation-mentions/{id}/triage', 'Actions/Api/V1/Reputation/TriageMentionAction').middleware('auth').middleware('team').rateLimit(120, 'minute')

// Sending domains are not the generated CRUD: `SenderDomain` declares `status`
// fillable, so that API would let a request body mark a domain verified.
route.get('/v1/sender-domains', 'Actions/Api/V1/Sending/ListSenderDomainsAction').middleware('auth').middleware('team')
route.post('/v1/sender-domains', 'Actions/Api/V1/Sending/CreateSenderDomainAction').middleware('auth').middleware('team').rateLimit(20, 'minute')
route.post('/v1/sender-domains/{id}/verify', 'Actions/Api/V1/Sending/VerifySenderDomainAction').middleware('auth').middleware('team').rateLimit(10, 'minute')
route.delete('/v1/sender-domains/{id}', 'Actions/Api/V1/Sending/DeleteSenderDomainAction').middleware('auth').middleware('team').rateLimit(20, 'minute')
// Claims the path before the generated create, which stores every sender as
// pending with no way to change it.
route.post('/v1/sender-identities', 'Actions/Api/V1/Sending/CreateSenderIdentityAction').middleware('auth').middleware('team').rateLimit(20, 'minute')

// Credentials are stored encrypted and never returned; the generated API
// only reads them.
route.post('/v1/integration-credentials', 'Actions/Api/V1/Integrations/StoreIntegrationCredentialAction').middleware('auth').middleware('team').rateLimit(10, 'minute')
route.delete('/v1/integration-credentials/{id}', 'Actions/Api/V1/Integrations/DeleteIntegrationCredentialAction').middleware('auth').middleware('team').rateLimit(20, 'minute')

// A workspace's own people. The framework's team actions do the work; these
// routes hold the path to the caller's team and check the caller's role
// first, which the framework's platform-admin routes do not.
route.get('/v1/team/people', 'Actions/Api/V1/Team/ListTeamPeopleAction').middleware('auth').middleware('team')
route.post('/v1/teams/{id}/invitations', 'Actions/Api/V1/Team/InviteTeamMemberAction').middleware('auth').middleware('team').rateLimit(20, 'minute')
route.post('/v1/teams/{id}/invitations/{invitationId}/resend', 'Actions/Api/V1/Team/ResendTeamInvitationAction').middleware('auth').middleware('team').rateLimit(10, 'minute')
route.delete('/v1/teams/{id}/invitations/{invitationId}', 'Actions/Api/V1/Team/RevokeTeamInvitationAction').middleware('auth').middleware('team').rateLimit(20, 'minute')
route.patch('/v1/teams/{id}/members/{memberId}', 'Actions/Api/V1/Team/UpdateTeamMemberAction').middleware('auth').middleware('team').rateLimit(30, 'minute')
route.delete('/v1/teams/{id}/members/{memberId}', 'Actions/Api/V1/Team/RemoveTeamMemberAction').middleware('auth').middleware('team').rateLimit(20, 'minute')

route.post('/webhooks/{provider}/{endpoint}', 'Actions/Webhooks/IngestWebhookAction').rateLimit(300, 'minute')

// `/coming-soon` is served as an STX view from
// `storage/framework/defaults/resources/views/coming-soon.stx`. The
// view auto-resolves through stx-serve, so no route registration is
// needed here. To activate the holding page across the whole app:
//
//   ./buddy coming-soon [--secret=my-magic-token]
//
// Launch the site with `./buddy launch`. Maintenance mode (503 page,
// distinct cookie + state file) is the separate `./buddy down` /
// `./buddy up` pair.
