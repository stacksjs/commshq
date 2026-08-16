import { route } from '@stacksjs/router'

route.post('/forms/{form}/submit', 'Actions/Public/SubscribeAction').rateLimit(20, 'minute')
route.get('/confirm/{token}', 'Actions/Public/ConfirmSubscriptionAction').rateLimit(30, 'minute')
route.get('/preferences/{token}', 'Actions/Public/PreferencesAction').rateLimit(60, 'minute')
route.post('/preferences/{token}', 'Actions/Public/UpdatePreferencesAction').rateLimit(30, 'minute')
route.post('/unsubscribe/{token}', 'Actions/Public/UnsubscribeAction').rateLimit(30, 'minute')
