---
id: "b5092c2f-84d3-4b0b-955f-d0024e5b97b1"
level: "task"
title: "The Live machine strip's vendor and model ignore the default vendor and hench model overrides, disagreeing with the effective config"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With `llm.vendor` unset and `llm.claude.model` set, /api/live reports vendor claude and that model (test)."
  - "With a `hench.models.claude` override, /api/live reports the override, matching GET /api/llm/config's effective block (test)."
description: "Failure: `resolveActiveModel` in `packages/web/src/server/routes-llm.ts:368-383` (used by `routes-live.ts:553` and `routes-live-analyze.ts:350`) returns {vendor:null, model:null} when `llm.vendor` is unset even if `llm.claude.model` or legacy `claude.model` is set, and ignores `hench.models.<vendor>` entirely. Main's `resolveEffectiveAgentConfig` (`effective-agent-config.ts:264`) applies `DEFAULT_LLM_VENDOR` and the hench overrides and is served as `effective` by GET /api/llm/config, so the Live strip and Robot Wrangler can show different robots for the same project.\n\nReachability: any project relying on the default vendor or a hench model override. Verdict: should-fix (severity medium). The per-field Claude resolution itself matches extractLlmConfig.\n\nOptions:\n- Recommended: cache the async `resolveEffectiveAgentConfig` result per projectDir, refreshed on the live monitor tick, and read the agent vendor and model from it. Small to medium.\n- Alternative: a synchronous variant of the effective resolver. Medium; duplicates logic."
lastModified: "2026-10-01T15:22:41.338Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
