---
title: Podcasts and feeds
description: Model podcast shows, episodes, and publication feeds.
---

# Podcasts and feeds

Podcasts belong to a publication and contain episodes. This keeps subscriber identity, promotional campaigns, publication access, and audio content in the same workspace.

## Episode workflow

1. Create the podcast and its public metadata.
2. Create an episode as a draft.
3. Attach the durable audio asset and complete title, summary, duration, and publication time.
4. Validate the generated feed.
5. Publish and confirm that external directories can fetch both feed and media URLs.
6. Send a campaign to the appropriate audience segment.

## Feed stability

Use stable GUIDs and permanent enclosure URLs. Do not change identifiers after publication, since podcast clients may treat the item as a new episode. Keep media content type, file length, and duration accurate.

## Access

For paid or mixed publications, enforce private feed or entitlement rules on the server. A hidden public URL is not an access-control mechanism.
