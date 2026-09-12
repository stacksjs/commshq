---
title: Commerce events and attribution
description: Ingest provider activity and connect engagement to revenue.
---

# Commerce events and attribution

Commerce connections and signed webhooks bring customer activity into the workspace. Supported event types include:

- `product_viewed`
- `cart_updated`
- `checkout_started`
- `order_created`
- `order_paid`
- `order_fulfilled`
- `order_refunded`
- `subscription_changed`

Each event keeps a provider-scoped external id, type, optional contact, amount, currency, raw payload, and occurrence time. The external id prevents duplicate storage for one connection.

## Attribution

Attribution events connect messages, links, referrals, or campaigns to later commerce activity. Decide the attribution model and window before comparing performance. Record the raw evidence needed to explain a result, including click, contact, provider event, and time.

## Money representation

Use the provider's currency and a consistent minor-unit convention. Refund events must reduce attributed revenue rather than appearing as additional positive sales. Reconcile CommsHQ totals against the commerce system of record.
