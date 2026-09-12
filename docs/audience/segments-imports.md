---
title: Segments and imports
description: Build reusable audiences and operate safe data movement.
---

# Segments and imports

Segments turn contact data and activity into reusable audiences. A segment has a name, description, match type, estimated count, refresh time, and one or more rules.

## Match behavior

- `all` requires every rule to match.
- `any` includes a contact when at least one rule matches.

Prefer stable attributes and explicit consent state in campaign segments. Avoid rules that depend on frequently changing free-form properties unless the refresh process and timing are understood.

## Segment snapshots

Campaign dispatch should operate on a reproducible audience. Snapshots preserve who qualified at a point in time and prevent later profile edits from silently changing the meaning of an already scheduled send.

## Imports

An audience import should define source, mapping, status, totals, errors, and timestamps. Before a large import:

1. Normalize email addresses and phone numbers.
2. Map fields and tags explicitly.
3. Preserve source and consent evidence.
4. Test with a small representative file.
5. Review duplicates, invalid records, and suppression conflicts.

## Exports

Audience exports are sensitive artifacts. Limit their lifetime, access, and fields. Record who requested the export and delete temporary files when the transfer or data request is complete.
