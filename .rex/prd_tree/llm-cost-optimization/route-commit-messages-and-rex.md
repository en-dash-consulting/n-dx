---
id: "2db5af0b-5e04-4b0b-9624-14543ccdca8e"
level: "feature"
title: "Route commit messages and rex mechanical calls to the light tier"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "rex"
  - "sourcevision"
  - "model-routing"
  - "haiku"
blockedBy:
  - "462b9503-b036-41ce-a07e-380e4137bf73"
source: "ndx-capture"
startedAt: "2026-08-31T13:55:33.492Z"
completedAt: "2026-08-31T14:01:54.956Z"
endedAt: "2026-08-31T14:01:54.956Z"
acceptanceCriteria:
  - "hench pre-run commit-message generation resolves to the light tier by default via the git.commit-message task class"
  - "rex sibling renames, body merges, group renames, consolidation guard, assessment pass, and guided clarify rounds resolve to the light tier via their task classes"
  - "sourcevision classification batches resolve to the light tier via code.classify"
  - "Every light-routed call validates output against a per-class structural contract (schema, enum, or length bound) before acceptance"
  - "The hench agent loop, rex proposal generation, and sourcevision enrichment passes 2+ remain on standard-or-stronger by default"
  - "Any light route can be reverted to standard with a one-line llm.routes config change"
description: "Mechanical, structured, single-shot call sites currently run on the full-price standard model (audit H8, R5). Route them to the light tier (claude-haiku-4-5) via the task-class registry: hench pre-run commit message (shared.ts:1134 — ≤12 KB diff → one line), rex sibling renames (rename-resolve.ts:97), body merges (reshape-reason.ts:376), group renames (propose-group-renames.ts:155), consolidation guard (consolidation-guard.ts:110), assessment pass (reason.ts:1340), guided clarify rounds (guided.ts:100), and sourcevision classification batches (classify.ts:328). Every light-routed call gets a strict output contract (schema/enum/length validation) with escalation to standard on failure (design P3). The hench agent loop, rex proposal generation, and sourcevision deep enrichment stay on standard-or-stronger per the cost-is-prefix-times-turns principle (design P1)."
lastModified: "2026-08-31T14:01:54.962Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
