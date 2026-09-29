---
id: "af64cc0d-b523-4304-8db2-5cb3388b238d"
level: "feature"
title: "Vendor-aware hench model and provider settings"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "vendor-aware-hench-config"
  - "pr-n"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
acceptanceCriteria:
  - "An invalid hench override in .n-dx.json or .n-dx.local.json warns, naming the key and the file, and falls back per field; no run is stopped by it."
  - "ndx work honours hench.models.<active vendor>; with no override set, model resolution is unchanged."
  - "The web server serves one per-vendor model catalog with each vendor's provider choices, which Robot Wrangler (94acd4e9, in Settings consolidation) uses."
description: "The dashboard's hench Config view is Claude-specific. Its Provider field offers cli and api for every vendor and calls itself the 'Claude provider', but hench allows cli or api for Claude, only cli for Codex (it refuses api), and forces api for Google and Local (packages/hench/src/cli/commands/run.ts, near 1450-1463). Its Model field is free text described as a Claude model, and it is dead: ndx work always passes a resolved model into the agent loop (flag, then llm.model / llm.<vendor>.model, then the vendor default, run.ts near 1279-1298), so the loops' opts.model ?? config.model fallback never reaches hench.model. Meanwhile the LLM Provider view's model suggestions are a hard-coded list in the viewer (packages/web/src/viewer/views/llm-provider.ts, MODEL_SUGGESTIONS) that can drift from llm-client's catalog.\n\nDecided 2026-09-23: the model setting in hench Config becomes a real agent-only override, per vendor, so ndx work can run a different model from analyze, plan and Ask. This adds one optional config key, which the amended epic criterion allows.\n\nRe-scoped 2026-09-29 for 0.8.0 Track B branch BN: backend only (b767dbff, 70ac46e4, 69848346). The Config-view UI task 94acd4e9 moved to Settings consolidation and targets Robot Wrangler."
lastModified: "2026-09-29T17:29:33.170Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Back the hench agent model with a real per-vendor override that ndx work honours](./back-the-hench-agent-model-with-a-real.md) | pending |
| [Serve one per-vendor model catalog and the provider choices each vendor supports from the web server](./serve-one-per-vendor-model-catalog-and.md) | pending |
| [Validate .n-dx.json hench overrides after the merge, falling back per field with a warning](./validate-n-dx-json-hench-overrides.md) | in_progress |
