/**
 * Signup forms on somebody else's page.
 *
 * The form is the creator's own markup, posting to CommsHQ. It has to work
 * with the browser's own submission - a form that only works once a script
 * has loaded loses every signup made before it did, and every signup made by
 * somebody whose script never loads at all. So this enhances a working form
 * rather than replacing one: it takes over the submit, sends the same fields
 * over `fetch`, and reports the outcome without a page load. Remove the
 * script and the form still posts.
 */

import type { CommsHqClient, SubscribeFields, SubscribeResult } from './client'
import { CommsHqError } from './client'

export interface BindFormOptions {
  /** The form's id in CommsHQ. Defaults to the element's `data-commshq-form`. */
  formId?: string
  /** Called before the request goes out, so a page can disable its button. */
  onStart?: () => void
  /** Called with the outcome. `confirmationRequired` decides which thank-you to show. */
  onSuccess?: (result: SubscribeResult) => void
  /** Called with a `CommsHqError`; `isRateLimited` and `isExpiredLink` say which. */
  onError?: (error: CommsHqError) => void
  /** Called once either way, so a page can re-enable its button in one place. */
  onSettled?: () => void
}

/** Undo a `bindForm`, for a page that swaps its markup out. */
export type Unbind = () => void

/**
 * The fields a form is carrying, as CommsHQ names them.
 *
 * Pure, and exported, because this is the part worth testing: a form whose
 * inputs are named slightly differently should still produce an email, and a
 * form that produces the wrong shape fails at the API with a message about
 * validation rather than about naming.
 */
export function readFormFields(form: HTMLFormElement): SubscribeFields {
  const data = new FormData(form)
  const collected: Record<string, string> = {}

  for (const [name, value] of data.entries()) {
    // A file input has no business in a signup form, and sending one would
    // fail JSON serialisation rather than validation.
    if (typeof value === 'string')
      collected[name] = value
  }

  /*
   * The address, under whichever name the markup gave it.
   *
   * Checked for content rather than for presence: a form that carries an
   * empty `email` alongside a filled `EMAIL` - which is what Mailchimp-shaped
   * markup with a honeypot looks like - would otherwise settle on the empty
   * one and post a blank address, and the visitor would be told their own
   * address was invalid.
   */
  const email = [collected.email, collected.EMAIL, collected.emailAddress, collected.email_address]
    .map(value => String(value ?? '').trim())
    .find(value => value !== '') ?? ''

  return { ...collected, email }
}

/**
 * Whether this browser can take over the submission at all.
 *
 * An old browser that cannot do this should be left to post the form the
 * ordinary way rather than have its submit cancelled by a handler that then
 * cannot send anything.
 */
function canEnhance(): boolean {
  return typeof globalThis.FormData === 'function' && typeof globalThis.fetch === 'function'
}

export function bindForm(
  client: CommsHqClient,
  form: HTMLFormElement,
  options: BindFormOptions = {},
): Unbind {
  const formId = options.formId ?? form.dataset?.commshqForm ?? ''

  if (!formId || !canEnhance()) {
    /*
     * Nothing is bound. The form keeps its own action and posts normally,
     * which is the behaviour this is enhancing rather than a failure state -
     * so there is no error here, and nothing to undo.
     */
    return () => undefined
  }

  let inFlight = false

  async function onSubmit(event: Event): Promise<void> {
    event.preventDefault()

    // A second submit while the first is in the air would spend another of
    // the twenty attempts a minute the endpoint allows, to no end.
    if (inFlight)
      return

    inFlight = true
    options.onStart?.()

    try {
      options.onSuccess?.(await client.subscribe(formId, readFormFields(form)))
      form.reset()
    }
    catch (error) {
      options.onError?.(error instanceof CommsHqError
        ? error
        : new CommsHqError(error instanceof Error ? error.message : 'The form could not be submitted.', 0))
    }
    finally {
      inFlight = false
      options.onSettled?.()
    }
  }

  form.addEventListener('submit', onSubmit)

  return () => form.removeEventListener('submit', onSubmit)
}

/**
 * Enhance every signup form on the page.
 *
 * Forms are found by `data-commshq-form`, which is also where each one's id
 * comes from - so a page with a footer form and a modal form needs no
 * script of its own, and a form added later is picked up by calling this
 * again.
 */
export function bindForms(
  client: CommsHqClient,
  options: BindFormOptions = {},
  root: ParentNode = globalThis.document,
): Unbind {
  if (!root || typeof root.querySelectorAll !== 'function')
    return () => undefined

  const unbinds = [...root.querySelectorAll<HTMLFormElement>('form[data-commshq-form]')]
    .map(form => bindForm(client, form, { ...options, formId: undefined }))

  return () => {
    for (const unbind of unbinds)
      unbind()
  }
}
