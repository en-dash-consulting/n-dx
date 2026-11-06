---
id: "aba3a023-d594-4962-9d63-a0be5775bb20"
type: "task"
title: "Codex quota reads a key held in the credential store"
slug: "codex-quota-reads-a-key-held-in-the"
description: "Should-fix from the #952 review. The codex quota notices in packages/hench/src/quota/index.ts (~line 139), quota/codex-quota.ts and quota/codex-token-retrieval.ts tell the user to run `ndx config credentials.codex` (and llm.codex.auth api), but quota resolves its key only from llmConfig.codex?.api_key ?? process.env.OPENAI_API_KEY (quota/index.ts ~line 118 and agent/lifecycle/shared.ts). A user who follows the notice still gets 'unavailable'. Resolve the key with resolveVendorApiKey('codex', …) through hench's llm-client gateway (respects auth), or keep the old message until quota reads the store. Mind the gateway export ceiling (tests/e2e/architecture-policy.test.js)."
acceptanceCriteria:
  - "With a codex key in the credential store and llm.codex.auth api, codex quota is fetched with that key"
  - "Under auth cli or auto with only a stored key, quota behaviour matches the notice it prints"
  - "No quota output contains the key"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "hench"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
