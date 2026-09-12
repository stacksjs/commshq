---
title: Email and SMS campaigns
description: Prepare, schedule, dispatch, and pause campaign delivery.
---

# Email and SMS campaigns

Campaigns coordinate a message, recipient selection, schedule, and delivery state. Email requires an address and sender identity. SMS requires a phone number and a configured provider.

## Dispatch behavior

`POST /api/v1/campaigns/{id}/dispatch` accepts campaigns in `draft`, `scheduled`, or `paused` state. It:

1. Resolves the active team and campaign.
2. Selects active contacts.
3. Chooses email or phone based on campaign type.
4. Creates one recipient snapshot per contact if it does not already exist.
5. Hashes the address and assigns an idempotency key.
6. Marks the campaign `scheduled` or `sending`.
7. Queues `DispatchCampaign` on the `campaigns` queue.

The endpoint responds with status `202` and the queued recipient count.

## Templates and blocks

Message templates and blocks separate reusable content from an individual campaign. Keep transactional and marketing content distinct, version important templates, and preview personalization with missing optional fields.

## SMS compliance

Honor opt-out keywords and channel-specific consent. The Twilio webhook path can return compliance XML for inbound messages. Do not send SMS to a contact without a valid phone number and the required permission for the intended purpose.

## Safe launch checklist

- Confirm sender identity and reply handling.
- Validate links, unsubscribe, and preference URLs.
- Test desktop, mobile, plain-text, and missing-field output.
- Estimate the eligible audience before dispatch.
- Confirm queues and provider credentials are healthy.
- Start with an internal or limited audience.
