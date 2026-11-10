---
id: "742cfeea-b375-443a-b72e-af34a87ef364"
type: "task"
title: "Codex provider registry decides API vs CLI from llm.codex.auth"
slug: "codex-provider-registry-decides-api-vs"
description: "Must-fix from the #949 stack review. packages/llm-client/src/provider-registry.ts:184 picks the OpenAI API provider whenever resolveOpenAiApiKey(config.codex) returns a key. Since #949, resolveOpenAiApiKey (openai-api-provider.ts:87) goes config → env → credential store and runs a helper, whatever llm.codex.auth says, while createOpenAiApiProvider then applies auth through requireVendorApiKey. The two disagree. (1) A codex key in the store with auth unset (credentials.codex --stdin, or the api_key alias when .n-dx.local.json is git-tracked): the registry picks the API, which throws 'needs a key and none may be used' instead of falling back to the codex CLI. (2) auth cli with any resolvable key: throws cliAuthConflictError instead of using the CLI. (3) A stored helper runs just to make the decision. hench hits it through failover to codex (loop.ts), useRegistryProvider and ProviderSession; the pre-run commit-message generator (shared.ts) swallows it and falls back to a generic subject. Same root cause: the exported resolveApiKey (config.ts) and resolveGoogleApiKey also return a stored key under auth cli. Fix: decide with resolveVendorAuth(...).mode, as create-client.ts does, and audit every caller that treats 'a key resolves' as 'use the API'."
acceptanceCriteria:
  - "With a codex key only in the credential store and llm.codex.auth unset, the default registry returns the codex CLI provider and runs no helper"
  - "With llm.codex.auth cli and an exported or stored OPENAI key, the default registry returns the codex CLI provider and does not throw"
  - "With llm.codex.auth api and a stored key, the default registry returns the OpenAI API provider using that key"
  - "No exported key resolver (resolveApiKey, resolveOpenAiApiKey, resolveGoogleApiKey) is used by a caller to choose API mode without consulting resolveVendorAuth"
  - "hench failover to codex succeeds with a stored codex key and auth unset"
priority: "high"
tags:
  - "credential-store"
  - "review-followup"
  - "llm-client"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
