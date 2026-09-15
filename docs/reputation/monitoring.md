---
title: Reputation monitoring and triage
description: Monitor profiles, ingest mentions, evaluate alerts, and coordinate responses.
---

# Reputation monitoring and triage

Monitored profiles represent an organization or creator identity on Google Business, Yelp, Facebook, Instagram, X, TikTok, LinkedIn, YouTube, Trustpilot, or Reddit.

## Collection

Background jobs poll and sync monitored profiles. Mentions are deduplicated by profile and external id, then stored with platform, kind, author, body, rating, sentiment, language, URL, raw provider data, and posted and fetched times.

## Triage states

A mention can be `new`, `triaged`, `responded`, or `ignored`. Use the triage endpoint to record the decision instead of relying on an external chat message that cannot be audited.

```http
POST /api/v1/reputation-mentions/{id}/triage
Authorization: Bearer <token>
```

## Alert rules

Rules can identify high-risk mentions by platform, rating, sentiment, or other configured conditions. The evaluation job creates alerts for matches. An acknowledgment endpoint records the team's decision:

```http
POST /api/v1/reputation-alerts/{id}/decision
Authorization: Bearer <token>
```

Sentiment is a prioritization signal, not a final judgment. Read the source content and context before responding.
