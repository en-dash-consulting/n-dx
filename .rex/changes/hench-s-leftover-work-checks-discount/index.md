---
id: "181fe90f-cf21-4fce-9569-fb7fe52ed4c6"
type: "change"
title: "Hench's leftover-work checks discount a rename out of a non-planning path into .rex/ by its target"
slug: "hench-s-leftover-work-checks-discount"
intent: "Pre-existing; out-of-scope finding from the adversarial review of bc98e476 (run db01b35a).\n\nScenario: during a run the agent stages `git mv src/app.ts .rex/changes/ch/app.ts`. `findUncommittedWork` (packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts:312-315) maps each porcelain line through `parsePorcelainPath`, which keeps only the R/C target, then filters it against `discountPaths` (PRD_COMMIT_PATHS). The rename's target is under the PRD root, so it is discounted, and the leftover-work check reports the tree clean even though `src/app.ts` was removed. `partitionDirtyPaths` (same file, ~388) has the same blind spot: it files the rename under `prd`.\n\nReachable: the between-task and post-run leftover checks: shared.ts:2307, shared.ts:4809, run.ts:2527, background-wait.ts:98, gate-only-retry.ts:135. Low severity, because the next pre-run gate refuses on the staged deletion. That gate's refusal now names the source, since bc98e476.\n\nFix options:\n(a) Recommended, and cheap: for R/C lines, discount only when both the source and the target match the discount paths. This needs a helper in store/artifacts.ts that exposes both paths.\n(b) Treat every R/C line as non-discountable. This is simpler, but it would stop discounting legitimate renames within .rex/.\n\nVerdict: out-of-scope, low."
acceptanceCriteria:
  - "findUncommittedWork with discountPaths PRD_COMMIT_PATHS reports a staged rename from src/app.ts into .rex/ as not clean, naming src/app.ts (hench test)"
  - "A staged rename wholly inside .rex/ is still discounted"
  - "partitionDirtyPaths files a rename from src/ into .rex/ under other, not prd"
touches:
  - "9cea889f-17de-4b92-a97e-b7279e158578"
priority: "low"
discoveredFrom: {"item":"bc98e476-b15f-4b1d-9b24-352ca15bcf6b","run":"db01b35a-1cc4-4b3a-8fd8-533ca528b6a7"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
