---
id: "2f0d7092-9b93-4929-b9f5-19c4918f9bb7"
level: "task"
title: "Optional Jev judgments and confidence for the migration plan"
status: "pending"
priority: "medium"
blockedBy:
  - "0734e6b6-9223-4669-8df7-058cf683f10d"
  - "d6419e1e-c15b-48ea-8e5c-cf781a65808e"
acceptanceCriteria: []
description: "An optional pass, off unless configured (rex.placement.models jev or both, or a migration option) and a TypeSafe key is present. It calls Jev through an injected seam with the same shape as PlacementJudge in core/placement-policy.ts, batching independent questions into one request:\n- a choice for items the rules mark uncertain (area, capability, constraint or change);\n- a noul for whether each proposed area is named for a job a user does;\n- a noul per drafted criterion: product behaviour, not process;\n- a noul per test link: does this test exercise this criterion.\nEach entry carries a confidence. The plan carries a review queue: held items first, then entries by ascending confidence, so reviewers start with the weakest calls. Jev never stamps reviewedHash and never accepts beyond rex.placement.autoAccept.\n\nAcceptance criteria:\n1. With the judge mocked, an uncertain item's entry carries Jev's choice and confidence; below the accept threshold it stays held (test).\n2. An area Jev judges not job-shaped is flagged with its probability (test).\n3. A test link Jev judges irrelevant is dropped from the requirement and counted in the plan (test).\n4. The review queue lists held items first, then entries by ascending confidence (test).\n5. Without a key the pass is skipped with one warning, and the plan equals the plan without the pass (test).\n6. Jev answers are recorded in the plan, and an unchanged re-run reuses them (test).\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`: the affected test gate refuses a stale rex dist/ (run 699cd138 failed only on that)."
lastModified: "2026-10-08T20:26:42.625Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
