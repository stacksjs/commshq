---
title: Webhooks
description: Configure, sign, deduplicate, process, and retry provider events.
---

# Webhooks

Inbound webhooks use this endpoint:

```http
POST /api/webhooks/{provider}/{endpointUuid}
```

Supported providers are `twilio`, `stripe`, `shopify`, `woocommerce`, `mail`, and `generic`.

## Verification

Each endpoint stores an encrypted secret. CommsHQ verifies the provider-specific signature against the raw body before accepting the event. Stripe and Twilio use their expected signature formats. Shopify, WooCommerce, mail, and generic endpoints use the configured HMAC behavior.

## Deduplication

CommsHQ extracts a provider event id from the expected header or payload field. A repeated provider and event id returns an accepted duplicate response without storing or processing the work again.

## Processing

Valid events are stored with the verified payload and queued as `ProcessWebhookEvent` on the `integrations` queue. Processing and retries happen outside the provider request so the endpoint can respond promptly.

## Response codes

| Status | Meaning |
| --- | --- |
| `202` | Accepted or already accepted as a duplicate |
| `400` | Invalid payload |
| `401` | Invalid signature |
| `404` | Unsupported provider or inactive endpoint |
| `422` | Provider event id missing |

Store a provider's exact raw request body for signature verification. Parsing and then serializing JSON can change bytes and invalidate an otherwise correct signature.
