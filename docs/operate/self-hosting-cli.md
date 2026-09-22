---
title: Self-hosting and CLI
description: Deploy CommsHQ with PostgreSQL, Redis, queues, scheduling, and provider services.
---

# Self-hosting and CLI

## Production services

The production cloud configuration runs a Stacks frontend and API with PostgreSQL, Redis-backed cache and queues, a scheduler, TLS, private uploads, public assets, and log storage.

Queue workers listen for campaign, automation, mail, SMS, commerce, integration, and default work. Keep the scheduler running for due campaigns, profile polling, alert evaluation, and retry jobs.

## Common commands

| Command | Purpose |
| --- | --- |
| `bun install` | Install dependencies |
| `./buddy dev` | Start local development |
| `./buddy generate:migrations` | Generate schema changes from models |
| `./buddy migrate` | Apply migrations |
| `./buddy generate:openapi` | Generate the current API specification |
| `./buddy build docs` | Build this BunPress site |
| `./buddy lint` | Run lint checks |
| `./buddy typecheck` | Run TypeScript checks |
| `./buddy test` | Run the test suite |

## Deployment checks

```bash
./buddy env:check --file .env.production --strict
./buddy deploy --dry-run --env production
./buddy cloud --diff
./buddy deploy --env production
```

Before production traffic, verify database migrations, Redis, each queue, the scheduler, mail and SMS providers, signed webhook delivery, public confirmation and unsubscribe routes, object storage, and backups.

BunPress writes the documentation site to `dist/docs/.bunpress`, which the cloud configuration serves at `/docs`.
