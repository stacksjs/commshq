# commshq-fx

The browser client for a [CommsHQ](https://commshq.org) workspace.

Signup forms, preference centres and unsubscribe links live on your own site,
not on ours. This is the code that talks to the endpoints behind them, so you
do not have to rediscover the response shapes — including the ones that are
not errors but read like them.

```bash
bun add commshq-fx
```

## Signing somebody up

```ts
import { createClient } from 'commshq-fx'

const commshq = createClient({ baseUrl: 'https://commshq.org' })

const { confirmationRequired } = await commshq.subscribe('your-form-id', {
  email: 'rosa@example.com',
  firstName: 'Rosa',
})
```

`confirmationRequired` is the form's own double opt-in setting, not something
you pass in — so it is the only thing that tells your page which thank-you to
show. A `202` here is success.

## Enhancing a form you already have

`bindForms` takes over the submit on every `form[data-commshq-form]` and sends
the same fields over `fetch`. It enhances a working form rather than replacing
one: remove the script and the form still posts.

```html
<form data-commshq-form="your-form-id" action="https://commshq.org/forms/your-form-id/submit" method="post">
  <input type="email" name="email" required />
  <button>Subscribe</button>
</form>
```

```ts
import { bindForms, createClient } from 'commshq-fx'

bindForms(createClient({ baseUrl: 'https://commshq.org' }), {
  onSuccess: result => show(result.confirmationRequired ? 'Check your email' : 'You are on the list'),
  onError: error => show(error.isRateLimited ? 'One moment, then try again' : error.message),
})
```

## Preference centres

Omitted channels are left alone. A form that only shows email must not opt
somebody out of SMS, so `updatePreferences` sends only what you name.

```ts
const preferences = await commshq.preferences(token)

await commshq.updatePreferences(token, { email: false })   // SMS untouched
await commshq.unsubscribe(token)
```

## Errors

Every refusal is a `CommsHqError` carrying the status, because the status is
the difference between "wait a minute" and "this link has expired":

| | meaning |
|---|---|
| `isRateLimited` | 429. The one refusal worth retrying unchanged. |
| `isExpiredLink` | 400 or 404. The link is spent, or the form is gone. |
| `isInvalidInput` | 422. The address did not look like an address. |
| `status === 0` | The request never arrived. Do not blame the visitor's address. |

## License

MIT
