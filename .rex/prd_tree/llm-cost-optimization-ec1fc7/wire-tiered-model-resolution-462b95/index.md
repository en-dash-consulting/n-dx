---
id: "462b9503-b036-41ce-a07e-380e4137bf73"
level: "feature"
title: "Wire tiered model resolution (task class → tier → model)"
status: "pending"
priority: "high"
tags:
  - "llm-client"
  - "rex"
  - "hench"
  - "sourcevision"
  - "config"
  - "model-routing"
source: "ndx-capture"
acceptanceCriteria:
  - "llm-client exposes resolveTaskModel(taskClass, config) returning {model, tier, effort}, backed by a DEFAULT_ROUTES registry of task classes"
  - "The .n-dx.json schema accepts llm.tiers.<vendor>, llm.routes.<class> (exact and glob-prefix), llm.escalation, and llm.effort, with ndx config validators and help text"
  - "Resolution precedence is CLI --model flag, then llm.routes, then built-in class default, then llm.tiers[vendor], then TIER_MODELS fallback; top-level llm.model sets the standard tier for backward compatibility"
  - "rex spawnClaude accepts a taskClass option at the llm-bridge choke point so all rex call sites resolve through the registry"
  - "sourcevision callClaude accepts the same taskClass option and resolveLightModel is replaced by resolveTaskModel('zone.enrich-scan')"
  - "hench resolves the agent loop via agent.execute and the commit-message generator via git.commit-message; the run-record weight field records the resolved tier instead of always 'standard'"
  - "The heavy tier is reachable via config (llm.routes['agent.execute'] = 'heavy') with no code change"
  - "A tier the configured vendor cannot distinguish resolves to the nearest available model, never an error"
  - "New LLM call sites without a declared task class are caught by a test walking spawnClaude/callClaude/loop call sites"
description: "The light/standard/heavy tier machinery exists in llm-client but is unwired (2 callers total, heavy tier unreachable — audit C2). Ship class→tier→model resolution: resolveTaskModel(taskClass, config) wrapping resolveVendorModel, with a built-in DEFAULT_ROUTES registry per the design's §04 call-site routing table. Call sites declare task classes (e.g. prd.rename, agent.execute, git.commit-message), never models. Config surface in .n-dx.json: llm.tiers.<vendor>.*, llm.routes.<class> (exact then glob-prefix match), llm.escalation.*, llm.effort.<class>. Resolution order: CLI flag → route → built-in class default → tier map → TIER_MODELS fallback; top-level llm.model becomes a standard-tier shorthand. Thread through rex's spawnClaude choke point (llm-bridge.ts:135), sourcevision's callClaude, and hench model resolution. This is the parent/foundation for the light-tier routing and escalation-ladder features."
lastModified: "2026-08-28T17:37:54.978Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [llm-client: resolveTaskModel + DEFAULT_ROUTES registry and routing config types](./llm-client-resolvetaskmodel-1e3ec2.md) | completed |
| [ndx config validators, help, and web UI paths for llm routing keys](./ndx-config-validators-help-and-24f506.md) | pending |
| [Thread taskClass through rex, sourcevision, and hench call sites](./thread-taskclass-through-rex-3c6d08.md) | pending |
