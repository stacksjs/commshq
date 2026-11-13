/**
 * Connected stores and the order events they send, through the
 * application's own API.
 *
 * This page was the `commerce` area of `WorkspaceSurface`: $84,620 of
 * attributed revenue, 318 recovered carts, 1.8M commerce events, a "Primary
 * Shopify store" that was "Healthy". None of it was read from anywhere, and
 * a workspace could not connect a store at all: a store's webhooks are only
 * accepted at an endpoint with a signing secret, and nothing could store
 * one.
 *
 * `/api/v1/commerce/stores` connects a store (a webhook endpoint and the
 * connection that lets its events be recorded), pauses and resumes it, and
 * replaces its signing secret. The secret is sent once, encrypted by the
 * server and never returned. `/api/v1/commerce-events` lists what arrived.
 *
 * ## What the page does not show
 *
 * No attributed revenue, no recovered carts, no return on spend: an event
 * is recorded, and nothing yet matches it to a contact, a campaign or an
 * automation. `NOT_USED_YET` says so on the page. No revenue total either:
 * events arrive in whatever currency the store uses, and adding them up
 * across currencies would be a number that means nothing.
 *
 * Only Shopify and WooCommerce, the two providers whose webhooks become
 * commerce events. Only orders, fulfilments and refunds, the three kinds
 * the processing job writes; a test holds both lists to the code.
 *
 * An event's payload is the store's own order record, with whatever it
 * holds about the buyer. The page does not render it.
 */
import { formatSeen } from './contacts-query'

export const STORES_ENDPOINT = '/api/v1/commerce/stores'
export const EVENTS_ENDPOINT = '/api/v1/commerce-events'
export const EVENTS_PER_PAGE = 20

/** The limits `app/Support/commerceStores.ts` applies; a test holds them together. */
export const STORE_NAME_MIN = 2
export const STORE_NAME_MAX = 120
export const SECRET_MIN = 8
export const SECRET_MAX = 4096

/**
 * The stores that can be connected, with where each one's signing secret
 * comes from. Written out here because a client module cannot import the
 * server's list; a test holds the two together.
 */
export const STORE_PROVIDERS = [
  {
    provider: 'shopify',
    label: 'Shopify',
    secretHint: 'In your Shopify admin, open Settings, Notifications, Webhooks. Shopify shows the secret it signs every webhook with on that page. Paste it here.',
    setup: 'In Shopify, open Settings, Notifications, Webhooks and create webhooks for order creation, fulfilment and refund, in JSON format, with this address.',
  },
  {
    provider: 'woocommerce',
    label: 'WooCommerce',
    secretHint: 'Choose a secret of your own, at least 8 characters with no spaces. You will enter the same one in WooCommerce.',
    setup: 'In WooCommerce, open Settings, Advanced, Webhooks and add webhooks for order created and order updated, with this delivery URL and the same secret.',
  },
] as const

/** The kinds of event the processing job writes, for the filter. */
export const EVENT_TYPES = [
  { value: 'order_created', label: 'Order' },
  { value: 'order_fulfilled', label: 'Fulfilment' },
  { value: 'order_refunded', label: 'Refund' },
] as const

export const NOT_USED_YET = 'Orders, fulfilments and refunds your store sends are recorded here. They are not yet matched to contacts, credited to campaigns or used to start automations, and carts and products are not read.'

function titleCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function providerOf(provider?: string | null) {
  return STORE_PROVIDERS.find(item => item.provider === provider)
}

export function providerLabel(provider?: string | null): string {
  return providerOf(provider)?.label ?? (provider ? titleCase(String(provider)) : 'Store')
}

export function eventTypeLabel(type?: string | null): string {
  return EVENT_TYPES.find(item => item.value === type)?.label ?? (type ? titleCase(String(type)) : 'Event')
}

export function storeUrl(id: number): string {
  return `${STORES_ENDPOINT}/${Math.trunc(Number(id))}`
}

/** Newest first, then id, since two events can share an instant. */
export function eventsUrl(query: { page?: number, perPage?: number, type?: string } = {}): string {
  const params = new URLSearchParams()
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  if (page > 1)
    params.set('page', String(page))
  params.set('per_page', String(Math.max(1, Math.trunc(query.perPage ?? EVENTS_PER_PAGE))))
  if (query.type)
    params.set('type', query.type)
  params.set('sort', '-occurred_at,-id')
  return `${EVENTS_ENDPOINT}?${params.toString()}`
}

export interface StoreRow {
  id: number
  provider?: string | null
  name?: string | null
  status?: string | null
  created_at?: string | null
  webhook_url?: string | null
  endpoint_status?: string | null
  events?: number | null
  last_event_at?: string | null
  failed_deliveries?: number | null
}

export interface StoreView {
  id: number
  provider: string
  name: string
  providerLabel: string
  status: string
  statusLabel: string
  /** Where the store posts, or '' when its endpoint is gone. */
  webhookUrl: string
  setup: string
  standing: string
  /** Deliveries that arrived and could not be recorded; '' when there are none. */
  failedNote: string
  nextStatus: string
  nextLabel: string
}

const STORE_STATUS_LABELS: Record<string, string> = {
  active: 'Receiving',
  disabled: 'Paused',
  pending: 'Pending',
  error: 'Error',
}

function count(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

/** Normalize one store into the shape the list renders. */
export function toStoreView(row: StoreRow, locale?: string): StoreView {
  const status = String(row.status || 'pending')
  const webhookUrl = String(row.webhook_url ?? '').trim()
  const events = count(row.events)
  const failed = count(row.failed_deliveries)
  // A store with no endpoint cannot receive anything, whatever its status says.
  const receiving = status === 'active' && webhookUrl !== '' && row.endpoint_status === 'active'

  let standing = 'Nothing has arrived from this store yet.'
  if (events > 0)
    standing = `${events.toLocaleString('en-US')} ${events === 1 ? 'event' : 'events'} recorded, the latest ${formatSeen(row.last_event_at, locale)}.`

  let statusLabel = STORE_STATUS_LABELS[status] ?? titleCase(status)
  if (status === 'active' && !receiving)
    statusLabel = 'Not receiving'

  const canChange = webhookUrl !== '' && (status === 'active' || status === 'disabled')
  return {
    id: row.id,
    provider: String(row.provider ?? ''),
    name: (row.name || '').trim() || `Store ${row.id}`,
    providerLabel: providerLabel(row.provider),
    status,
    statusLabel,
    webhookUrl,
    setup: providerOf(row.provider)?.setup ?? '',
    standing,
    failedNote: failed > 0 ? `${failed.toLocaleString('en-US')} ${failed === 1 ? 'delivery' : 'deliveries'} arrived and could not be recorded.` : '',
    nextStatus: canChange ? (status === 'active' ? 'disabled' : 'active') : '',
    nextLabel: canChange ? (status === 'active' ? 'Pause' : 'Resume') : '',
  }
}

export interface StoresView {
  stores: StoreView[]
  canManage: boolean
  /** The providers that can still be connected: one store each. */
  available: Array<{ provider: string, label: string }>
}

export function toStoresView(body: { data?: StoreRow[], can_manage?: unknown } | null | undefined, locale?: string): StoresView {
  const stores = (body?.data ?? []).map(row => toStoreView(row, locale))
  return {
    stores,
    // Only a literal true: a missing answer is not permission.
    canManage: body?.can_manage === true,
    available: STORE_PROVIDERS.filter(item => !stores.some(store => store.provider === item.provider)).map(item => ({ provider: item.provider, label: item.label })),
  }
}

export interface EventRow {
  id: number
  external_id?: string | null
  type?: string | null
  amount?: number | string | null
  currency?: string | null
  occurred_at?: string | null
  commerce_connection_id?: number | null
}

export interface EventView {
  id: number
  typeLabel: string
  amountLabel: string
  reference: string
  occurredLabel: string
  storeId: number
}

/** An amount in minor units as money in its own currency, or '' when there is none. */
export function formatAmount(amount: unknown, currency?: string | null, locale: string = 'en-US'): string {
  const minor = Number(amount)
  if (amount == null || amount === '' || !Number.isFinite(minor) || minor <= 0)
    return ''
  const code = String(currency || 'USD').toUpperCase()
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(minor / 100)
  }
  catch {
    // Not a currency code the runtime knows: the number and the code as sent.
    return `${(minor / 100).toFixed(2)} ${code}`
  }
}

/** Normalize one event. The payload is deliberately not read. */
export function toEventView(row: EventRow, locale?: string): EventView {
  return {
    id: row.id,
    typeLabel: eventTypeLabel(row.type),
    amountLabel: formatAmount(row.amount, row.currency, locale),
    reference: String(row.external_id ?? '').trim(),
    occurredLabel: formatSeen(row.occurred_at, locale),
    storeId: count(row.commerce_connection_id),
  }
}

export function toEventViews(body: { data?: EventRow[] } | null | undefined, locale?: string): EventView[] {
  return (body?.data ?? []).map(row => toEventView(row, locale))
}

/** Why a signing secret cannot be stored, by the rule the server applies. */
export function secretError(value?: string | null): string {
  const secret = (value ?? '').trim()
  if (!secret)
    return 'Enter the signing secret.'
  if (/\s/.test(secret))
    return 'A signing secret cannot contain spaces or line breaks.'
  if (secret.length < SECRET_MIN)
    return `That is too short to be a signing secret. It needs at least ${SECRET_MIN} characters.`
  if (secret.length > SECRET_MAX)
    return `A signing secret can be at most ${SECRET_MAX} characters.`
  return ''
}

export interface ConnectDraft {
  provider?: string
  name?: string
  secret?: string
}

export function connectError(draft: ConnectDraft): string {
  if (!providerOf(draft.provider))
    return 'Choose which kind of store this is.'
  const name = (draft.name ?? '').replace(/\s+/g, ' ').trim()
  if (name.length < STORE_NAME_MIN)
    return `A store needs a name of at least ${STORE_NAME_MIN} characters.`
  if (name.length > STORE_NAME_MAX)
    return `A store name can be at most ${STORE_NAME_MAX} characters.`
  return secretError(draft.secret)
}

export function connectPayload(draft: ConnectDraft): { provider: string, name: string, secret: string } {
  return {
    provider: String(draft.provider ?? ''),
    name: (draft.name ?? '').replace(/\s+/g, ' ').trim(),
    secret: (draft.secret ?? '').trim(),
  }
}

/** What to tell someone when a list failed. */
export function listErrorMessage(status: number, what: 'stores' | 'events' = 'stores'): string {
  const label = what === 'stores' ? 'Stores' : 'Events'
  if (status === 401)
    return `Your session has ended. Sign in again to see your ${what}.`
  if (status === 403)
    return `This account is not an active member of a workspace, so it has no ${what} to show.`
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return `${label} could not be loaded because the API is not answering.`
  return `${label} could not be loaded (${status}).`
}

/** What to tell someone when connecting or changing a store failed. */
export function saveErrorMessage(status: number): string {
  if (status === 409)
    return 'This workspace already has a store of that kind connected. Each kind can be connected once.'
  if (status === 422)
    return 'That was rejected as invalid. Check the name and the signing secret.'
  if (status === 404)
    return 'That store no longer exists. The list has been refreshed.'
  if (status === 401)
    return 'Your session has ended. Sign in again to change this store.'
  if (status === 403)
    return 'Connecting or changing a store needs an admin or owner role.'
  if (status === 429)
    return 'Too many attempts just now. Wait a minute and try again.'
  return `The store could not be saved (${status}).`
}
