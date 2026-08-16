# CommsHQ

CommsHQ is a creator-first communications, publishing, automation, and commerce marketing platform built with Stacks.

## Product areas

- Consent-aware audiences, segments, custom fields, and imports
- Email and SMS campaigns with experiments and delivery reporting
- Versioned automation journeys with retries and approvals
- Publications, sites, forms, gated resources, podcasts, and feeds
- Commerce event ingestion, attribution, recovery, and monetization
- Workspace billing, usage, audit, compliance, and integrations

## Development

CommsHQ requires Bun 1.3 or newer and uses only packages owned by the Stacks ecosystem.

```bash
bun install
./buddy migrate:fresh --seed
./buddy dev
```

Run the full local quality gate with:

```bash
./buddy lint
./buddy typecheck
./buddy test
./buddy generate:openapi
```

Database migrations are generated from models in `app/Models`:

```bash
./buddy generate:migrations
./buddy migrate
```

Never create or edit migrations by hand.

## Production

Production is attached to the shared `stacks` host and deployed through Buddy. Environment values must be encrypted before they are committed.

```bash
./buddy env:check --file .env.production --strict
./buddy deploy --dry-run --env production
./buddy cloud --diff
./buddy deploy --env production
```

## License

MIT
