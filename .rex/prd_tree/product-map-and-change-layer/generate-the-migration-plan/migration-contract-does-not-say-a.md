---
id: "1dd3ea85-2672-4fc4-b8a8-6ff014f25fc7"
level: "task"
title: "Migration contract does not say a model question must carry every input its answer depends on, so a minimal question reuses a stale answer"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-13"
  - "product-map"
  - "rex"
blockedBy:
  - "d6419e1e-c15b-48ea-8e5c-cf781a65808e"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T00:46:04.398Z"
completedAt: "2026-10-09T00:51:45.390Z"
endedAt: "2026-10-09T00:51:45.390Z"
resolutionType: "code-change"
resolutionDetail: "Documented the ModelQuestion contract; added a spec-pass test that a completed child re-asks the parent."
acceptanceCriteria:
  - "ModelQuestion's documentation states that the question carries every input the answer depends on, and the source item hash covers only the item's own content"
  - "For the first model pass that drafts from an item's children, a test shows completing a child task causes the parent's question to be asked again"
description: "Scenario: the v1 source adapter (packages/rex/src/migrations/v1-to-v2/index.ts, itemContent) hashes an item's own fields and parent only, not its children. A recorded answer is reused when hash(item hash, question) matches (packages/rex/src/migrations/pipeline.ts answerHash). A capability spec pass whose question is just { capability: id } would reuse its drafted spec after a child task completed or its criteria changed: a silent stale answer. Correct only when the question itself carries the history and evidence the model reads.\n\nReachable: when the text spec pass (d6419e1e) or Jev pass (2f0d7092) define their questions; not today. Introduced by ab7b00bb. Verdict: should-fix, low — a contract gap, no current failure.\n\nOptions:\n1. (Recommended) State in ModelQuestion/ModelPass docs (migrations/migration.ts) that the question must contain every input the answer depends on, and add a test in the first model pass that a child change re-asks its parent. Cost: a doc line + one test per pass.\n2. Let a pass declare the item ids its question depends on and fold their hashes into answerHash. Cost: moderate API change; risk: more re-asks.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it (runs 699cd138 and the PR 17 store-transaction run failed only on that)."
lastModified: "2026-10-09T00:51:45.655Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
