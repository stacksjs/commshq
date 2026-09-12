---
title: Quick start
description: Run CommsHQ locally and learn the first end-to-end workflow.
---

# Quick start

## Requirements

- Bun 1.3 or newer
- SQLite for local development
- PostgreSQL and Redis for the production configuration

## Run locally

```bash
git clone https://github.com/stacksjs/commshq.git
cd commshq
bun install
./buddy migrate:fresh --seed
./buddy dev
```

The seeded database supplies representative contacts, segments, campaigns, content, automations, commerce events, and reputation data.

## Learn one complete flow

1. Select the active team workspace.
2. Create or inspect a contact with an email address and active consent.
3. Add the contact to an audience or define a matching segment.
4. Prepare an email campaign with a sender identity and template.
5. Dispatch the campaign and inspect recipient and delivery records.
6. Submit a public form to see double opt-in and preference handling.
7. Configure a signed webhook endpoint and send a provider test event.

## Validate a change

```bash
./buddy lint
./buddy typecheck
./buddy test
./buddy generate:openapi
```

Do not edit migrations by hand. Change a model, run `./buddy generate:migrations`, inspect the generated migration, and apply it with `./buddy migrate`.
