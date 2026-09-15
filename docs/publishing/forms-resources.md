---
title: Forms and gated resources
description: Collect signups, confirm consent, manage preferences, and grant resource access.
---

# Forms and gated resources

Form definitions control public signup behavior, including whether double opt-in is required. Submit forms to:

```http
POST /forms/{formUuid}/submit
Content-Type: application/json
```

```json
{
  "email": "reader@example.com",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "jurisdiction": "US-CA"
}
```

The endpoint validates the form and email, rate limits by form and hashed client IP, deduplicates same-day submissions, creates or finds the contact, records consent, and queues confirmation mail when required.

## Public links

| Path | Purpose |
| --- | --- |
| `GET /confirm/{token}` | Confirm a pending subscription |
| `GET /preferences/{token}` | Read public communication preferences |
| `POST /preferences/{token}` | Update preferences |
| `POST /unsubscribe/{token}` | Unsubscribe the contact |

Tokens are signed and purpose-specific. Do not reuse a confirmation token for preferences or unsubscribe.

## Gated resources

Grant access only after the required consent, subscription, or entitlement condition is met. Store the resource independently from the public landing page so access decisions can be enforced server-side.
