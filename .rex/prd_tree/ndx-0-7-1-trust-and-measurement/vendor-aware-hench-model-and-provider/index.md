---
id: "af64cc0d-b523-4304-8db2-5cb3388b238d"
level: "feature"
title: "Vendor-aware hench model and provider settings"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "vendor-aware-hench-config"
  - "pr-n"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
acceptanceCriteria:
  - "The hench Config view shows the active vendor, offers only the providers that vendor supports, and picks the agent model from that vendor's model list, with free entry still possible."
  - "ndx work honours the per-vendor agent model override; with no override set, behaviour is unchanged."
  - "The dashboard's model lists come from one server-side catalog, not a hard-coded list in the viewer."
description: "The dashboard's hench Config view is Claude-specific. Its Provider field offers cli and api for every vendor and calls itself the 'Claude provider', but hench allows cli or api for Claude, only cli for Codex (it refuses api), and forces api for Google and Local (packages/hench/src/cli/commands/run.ts, near 1450-1463). Its Model field is free text described as a Claude model, and it is dead: ndx work always passes a resolved model into the agent loop (flag, then llm.model / llm.<vendor>.model, then the vendor default, run.ts near 1279-1298), so the loops' opts.model ?? config.model fallback never reaches hench.model. Meanwhile the LLM Provider view's model suggestions are a hard-coded list in the viewer (packages/web/src/viewer/views/llm-provider.ts, MODEL_SUGGESTIONS) that can drift from llm-client's catalog.\n\nDecided 2026-09-23: the model setting in hench Config becomes a real agent-only override, per vendor, so ndx work can run a different model from analyze, plan and Ask. This adds one optional config key, which the amended epic criterion allows."
lastModified: "2026-09-23T23:40:49.733Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Honour a per-vendor agent model override in ndx work](./honour-a-per-vendor-agent-model.md) | pending |
| [Make the hench Config view vendor-aware: provider choices and an agent-model picker for the active vendor](./make-the-hench-config-view-vendor.md) | pending |
| [Serve one per-vendor model catalog and use it in the LLM Provider view](./serve-one-per-vendor-model-catalog-and.md) | pending |
| [Validate .n-dx.json hench overrides after the merge, falling back per field with a warning](./validate-n-dx-json-hench-overrides.md) | pending |
