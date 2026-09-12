---
title: Versioned journeys
description: Publish automation graphs and operate step runs, approvals, retries, and dead letters.
---

# Versioned journeys

An automation journey is stored as a graph. Publishing creates an immutable version with a version number, graph, checksum, publisher, and publication time. Runs should retain the version that started them even after the automation is edited.

## Typical nodes

- Entry trigger from a form, tag, commerce event, schedule, or provider event
- Condition or segment check
- Wait until a time or for a duration
- Send email or SMS
- Update a contact, tag, audience, or entitlement
- Request approval before a sensitive action
- Exit, failure, or recovery path

## Execution records

Automation step runs expose which node is running, complete, waiting, failed, or retried. Dead-letter records preserve work that exceeded retry policy. Approvals record the decision and actor for steps that require human control.

## Design guidance

- Make every side effect idempotent.
- Put a ceiling on retries and wait duration.
- Add explicit exits for unsubscribed or suppressed contacts.
- Re-check consent immediately before communication.
- Publish a new version for every graph change.
- Keep a manual recovery path for failed steps.
