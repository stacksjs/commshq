---
title: Contacts and consent
description: Model identities, channels, consent, preferences, and suppression safely.
---

# Contacts and consent

A contact can have an email address, phone number, name, status, source, custom properties, identities, tags, and engagement time. Email uniqueness is scoped to the team.

## Contact states

| Status | Meaning |
| --- | --- |
| `active` | Eligible for communication when consent and campaign rules allow it |
| `pending` | Waiting for confirmation, commonly during double opt-in |
| `unsubscribed` | Opted out of marketing communication |
| `suppressed` | Blocked because of policy, provider feedback, or operational decision |
| `archived` | Retained but removed from active use |

## Consent lifecycle

Public signup forms record whether consent was requested or confirmed, along with purpose, source, jurisdiction, policy version, proof, IP address, and time. A double opt-in form queues a confirmation email with a signed token that expires after 48 hours.

Preference and unsubscribe links also use signed public tokens. Preserve the event history instead of replacing it with a single boolean. This provides evidence of how and when a contact's permission changed.

## Data minimization

Store only data needed for segmentation, personalization, delivery, or a documented business process. Use custom fields for stable structured data, tags for lightweight classification, and properties for limited integration metadata. Do not place credentials or payment details in contact properties.

## Identity and merge

Contact identities map provider or channel identifiers to one contact. Merge records should retain provenance so the team can explain why identities were combined and reverse mistakes through a controlled process.
