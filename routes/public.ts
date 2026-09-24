import { route } from '@stacksjs/router'

/*
 * The public surface: signup forms embedded on other people's sites, and the
 * links in the emails they lead to. None of it runs in a CommsHQ session, so
 * the POSTs skip CSRF (there is no CommsHQ cookie to pair a token with) and
 * lean on signed tokens and rate limits instead. The GETs are reached through
 * the views server's API proxy (config/server.ts).
 */
route.post('/forms/{form}/submit', 'Actions/Public/SubscribeAction').skipCsrf().rateLimit(20, 'minute')
route.get('/confirm/{token}', 'Actions/Public/ConfirmSubscriptionAction').rateLimit(30, 'minute')
route.get('/preferences/{token}', 'Actions/Public/PreferencesAction').rateLimit(60, 'minute')
route.post('/preferences/{token}', 'Actions/Public/UpdatePreferencesAction').skipCsrf().rateLimit(30, 'minute')
route.get('/unsubscribe/{token}', 'Actions/Public/UnsubscribePageAction').rateLimit(60, 'minute')
route.post('/unsubscribe/{token}', 'Actions/Public/UnsubscribeAction').skipCsrf().rateLimit(30, 'minute')
