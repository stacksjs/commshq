---
title: Security and compliance
description: Protect credentials, preserve consent, and operate auditable communication workflows.
---

# Security and compliance

## Team isolation

Application APIs require both authentication and active team context. New endpoints must scope every query and mutation to the team resolved from the request. Do not accept a client-supplied team id as authorization.

## Credentials

Integration credentials and webhook secrets are encrypted and hidden by their models. Keep database, mail, provider, AI, and cloud credentials in encrypted environment configuration. Never return decrypted secrets through an API.

## Consent and suppression

Re-check consent and suppression immediately before delivery, not only when a campaign is created. Record consent source, purpose, policy version, proof, jurisdiction, and time. Honor preference and unsubscribe changes across every relevant channel.

## Auditing and requests

Audit events should record material administrative actions. Data-request records should coordinate access, correction, export, and deletion workflows. Retention policies should define what is retained, for how long, and the legal or operational basis.

## Recommended controls

- Use least-privilege provider credentials.
- Verify every inbound webhook signature.
- Rate limit public forms and authentication.
- Hash addresses in delivery records where the clear value is unnecessary.
- Encrypt private exports and remove temporary copies.
- Keep durable queues and inspect dead letters.
- Review team access, senders, integrations, and public forms regularly.
