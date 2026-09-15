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
./buddy migrate --auth
./buddy seed
./buddy dev
```

Set `COMMSHQ_OWNER_PASSWORD` to a password you choose in your local `.env` before running `./buddy seed`. You can also set `COMMSHQ_OWNER_EMAIL`; otherwise the owner seeder uses `chris@stacksjs.com`. Without the password, the owner seeder skips account and workspace creation outside production, so there is no owner account to sign in with. In production it fails instead of creating an account with an empty password.

The model seeders can create sample records, but they do not replace the owner bootstrap or prove that every workflow below is connected in the dashboard. Start by signing in with the owner account you configured, then inspect the seeded workspace and available API surfaces.

`./buddy migrate:fresh --seed` drops every table. Use it only when you deliberately want to reset a disposable development database, not as the normal setup path for an existing checkout.

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
