/**
 * Names a render context carries into a template, as AMBIENT declarations.
 *
 * stx renders a template with the keys of its context as bare names, so a value
 * a host hands `renderTemplate` arrives with no declaration for `stx typecheck`
 * to find. `requestContext` and `query` are the framework's and are declared in
 * storage/framework/types/request-context.d.ts; this file declares the ones
 * that are this app's. Both are passed with `--lib` by `typecheck:views`.
 *
 * Shapes are restated rather than imported: a `--lib` file with an import stops
 * being ambient and would take every declaration here out of scope.
 */

/**
 * resources/templates/public-preferences.stx, rendered only by
 * app/Actions/Public/PreferencesAction.ts with
 * `{ token, contact, channels }`. Not optional: the template is never rendered
 * without them, so a guard would be checking for a call that cannot happen.
 */

/** The signed preference-link token from the URL, posted back by the form. */
declare const token: string

/** The contact the link was issued for, normalised by the action. */
declare const contact: { email: string, phone: string }

/** Per-channel state from `channelPreference`: whether it can be offered, and whether it is on. */
declare const channels: {
  email: { available: boolean, enabled: boolean }
  sms: { available: boolean, enabled: boolean }
}
