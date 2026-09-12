---
title: API
description: Use CommsHQ team-scoped application and generated model APIs.
---

# API

Authenticated APIs require the user's bearer token and active team context. The `auth` and `team` middleware ensure records are scoped to the workspace.

## Command endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/workspace` | Active contacts, campaigns, publications, automation runs, revenue, and usage |
| `POST` | `/api/v1/campaigns/{id}/dispatch` | Snapshot recipients and queue campaign delivery |
| `POST` | `/api/v1/ai/generate` | Create an AI draft generation |
| `POST` | `/api/v1/ai-generations/{id}/decision` | Accept or reject an AI generation |
| `POST` | `/api/v1/monitored-profiles` | Create a monitored reputation profile |
| `POST` | `/api/v1/reputation-alert-rules` | Create or update an alert rule |
| `POST` | `/api/v1/reputation-alerts/{id}/decision` | Acknowledge or decide an alert |
| `POST` | `/api/v1/reputation-mentions/{id}/triage` | Update mention triage state |

## Generated resource APIs

Many models expose authenticated team-scoped CRUD or read APIs under `/api/v1`. These include contacts, custom fields, tags, audiences, segments, templates, publications, forms, pages, podcasts, automation records, commerce records, webhooks, reputation records, usage, and compliance data.

Run the OpenAPI generator for the exact route and schema set in your checkout:

```bash
./buddy generate:openapi
```

Generated model APIs evolve with the model definitions. Regenerate the specification and client bindings during every compatible release process.
