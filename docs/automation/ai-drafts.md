---
title: AI drafts and approvals
description: Generate draft content while keeping publication decisions with the team.
---

# AI drafts and approvals

CommsHQ can generate draft content through an authenticated, team-scoped endpoint:

```http
POST /api/v1/ai/generate
Authorization: Bearer <token>
```

Generated content is recorded as an AI generation rather than silently replacing a campaign or publication. A separate decision endpoint accepts or rejects the result:

```http
POST /api/v1/ai-generations/{id}/decision
Authorization: Bearer <token>
```

## Review workflow

1. Provide a specific brief, audience, channel, and constraints.
2. Generate a draft.
3. Review factual claims, tone, links, personalization, and compliance language.
4. Accept or reject the stored generation.
5. Preview the final message in the actual channel.
6. Publish or dispatch through the normal controlled workflow.

AI output is untrusted draft material. Do not place secrets, full customer records, or credentials in prompts. A human remains responsible for factual accuracy, brand voice, consent, and the final send.
