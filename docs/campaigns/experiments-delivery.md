---
title: Experiments and delivery
description: Understand variants, recipient snapshots, attempts, events, and retries.
---

# Experiments and delivery

Campaign experiments compare message variants while preserving which recipient saw which treatment. Define the hypothesis, primary metric, allocation, and decision window before dispatch.

## Delivery records

The delivery model separates several concerns:

- Campaign recipients preserve the address, contact data, channel, schedule, status, and idempotency key used for a send.
- Delivery attempts record provider calls and retry outcomes.
- Delivery events record accepted, delivered, opened, clicked, bounced, complained, failed, or other provider feedback.
- Campaign experiments record variant definitions and results.

## Idempotency

A campaign recipient is unique for a contact and campaign. The dispatch action skips an existing recipient and produces a stable key based on team, campaign, and contact identity. Provider adapters should also pass an idempotency key where supported.

## Retries

Retry only transient failures. Permanent address errors, complaints, and opt-outs should update suppression or consent state. Keep a bounded attempt count and move exhausted work to an inspectable failure or dead-letter state.

## Reporting

Interpret opens cautiously because privacy features and image blocking affect accuracy. Prefer delivered, bounced, complained, clicked, converted, and attributed revenue metrics when evaluating campaign health.
