---
id: "bc98e476-b15f-4b1d-9b24-352ca15bcf6b"
type: "change"
title: "The pre-run gate's refusal names only the target of a rename that leaves a non-planning path"
slug: "the-pre-run-gate-s-refusal-names-only"
intent: "Pre-existing; out-of-scope finding from the adversarial review of 6d750811 (run 32bf41ca).\n\nScenario: `git mv src/app.ts .rex/changes/ch/app.ts`, then `ndx work --auto`. The gate correctly refuses, because the rename is not all-planning. But the refusal lists only `.rex/changes/ch/app.ts`. The operator's real work, the move out of `src/`, is not named, so the message reads as if the problem were an n-dx file.\n\nEvidence: the refusal is built by `formatDirtyFileList(dirty)` in packages/hench/src/agent/lifecycle/shared.ts, and `run-resolve.ts` builds `split.other.map(parsePorcelainPath)`. `parsePorcelainPath` (packages/hench/src/store/artifacts.ts:274) keeps only the new path of an R/C line.\n\nReachable: `hench run` / `ndx work` refusals and `ndx work --resolve`. Display only; the behaviour is correct.\n\nFix options:\n(a) Render R/C lines as `old -> new` in both refusal lists. This is cheap, and recommended.\n(b) List both paths separately. That inflates the file count.\n\nVerdict: out-of-scope, low."
acceptanceCriteria:
  - "A refused autonomous run whose only dirty entry is a staged rename from src/app.ts into .rex/ names src/app.ts in its refusal (hench test)"
  - "ndx work --resolve's dirty-tree refusal names a rename's source path as well as its target"
touches:
  - "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
priority: "low"
discoveredFrom: {"item":"6d750811-4a02-4569-9b52-b55d0d0ea6a4","run":"32bf41ca-1382-43ec-9219-1a09b2224301"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
