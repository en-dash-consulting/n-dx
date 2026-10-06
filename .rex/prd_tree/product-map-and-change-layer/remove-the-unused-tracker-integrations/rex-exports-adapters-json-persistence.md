---
id: "469324e0-3297-4b8a-8b46-d053067cca3a"
level: "task"
title: "rex exports adapters.json persistence and credential helpers with no remaining consumer"
status: "in_progress"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-03"
  - "rex"
source: "ndx-adversarial-review"
startedAt: "2026-10-06T14:31:14.497Z"
acceptanceCriteria:
  - "Either packages/rex/src/store/adapter-config.ts is deleted with its public.ts and store/index.ts re-exports and its unit test, or the feature description records an explicit decision to keep a named subset and why"
  - "No symbol exported from packages/rex/src/public.ts lacks an in-repo consumer or a documented reason to exist, for the adapter-config exports"
  - "pnpm build, pnpm typecheck and the rex test suite pass after the change"
description: "DECISION (Ryan, 2026-10-06): take option 1 — remove the unused adapters code entirely. Delete packages/rex/src/store/adapter-config.ts, its re-exports from packages/rex/src/public.ts and src/store/index.ts, and tests/unit/store/adapter-config.test.ts. This supersedes the feature description's instruction to keep the redaction and env-var helpers: their last caller is gone, and the planned @n-dx/bridge package will own its own config. Keep file-adapter.ts (the local store) and src/core/sync.ts (item bookkeeping) untouched. Sweep any remaining mention of adapters.json or the adapter-config helpers from docs, and keep the assistant instruction surfaces in step: anything that reaches CLAUDE.md must also reach AGENTS.md (root files are generated from packages/core/assistant-assets/; regenerate both, never edit only one). Add a patch changeset for @n-dx/rex.\n\nVerdict: should-fix (low). Caused by task 1444b872 (dashboard Notion surface removal, commit 3c8a8c177), not fixed there because it is a rex public-API decision.\n\nScenario: packages/rex/src/store/adapter-config.ts was extracted in task 6202f721 so web's routes-notion.ts could keep reading .rex/adapters.json. routes-notion.ts was its only caller (via a dynamic import of @n-dx/rex/dist/store/adapter-config.js) and has now been deleted. The module is still re-exported from packages/rex/src/public.ts:159-166 (loadAdapterConfigs, getAdapterConfig, saveAdapterConfig, removeAdapterConfig, AdapterConfig, AdapterConfigField) and from src/store/index.ts:67-82, and still tested by tests/unit/store/adapter-config.test.ts. Nothing in the repo imports it. If the 1.0.0 freeze lands with it in public.ts, a persistence API for a removed feature becomes a semver commitment.\n\nReachability: only via the published @n-dx/rex public API; no in-repo caller. Not covered by any check — the gateway and domain-isolation tests flag bad imports, not unused exports.\n\nTension: the feature description says to keep the env-var resolution and credential redaction helpers from adapter-registry.ts. That instruction predates the removal of their last caller, so it needs a decision rather than a silent delete.\n\nOptions:\n1. Delete adapter-config.ts, its public.ts/store/index.ts re-exports and its test (recommended). Cost: small, contained in rex. Risk: an external consumer of @n-dx/rex's public API loses the functions — acceptable pre-1.0 and the planned @n-dx/bridge package would own its own config.\n2. Keep the redaction/env helpers (isSensitiveField, envVarName, redactValue, resolveRedactedConfig) for the future bridge, but drop the adapters.json persistence functions from public.ts. Cost: small. Risk: keeps speculative API with no consumer.\n3. Keep everything and amend the feature description to say why. Cost: none now. Risk: the freeze captures it."
lastModified: "2026-10-06T14:31:14.930Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
