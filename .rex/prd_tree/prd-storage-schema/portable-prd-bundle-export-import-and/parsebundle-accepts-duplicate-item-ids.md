---
id: "68ee0634-87af-428f-a950-e0a8e3a1183b"
level: "task"
title: "`parseBundle` accepts duplicate item ids; `--replace` writes them into the tree"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-09-10T16:37:54.223Z"
completedAt: "2026-09-10T16:42:34.330Z"
endedAt: "2026-09-10T16:42:34.330Z"
resolutionType: "code-change"
resolutionDetail: "parseBundle now rejects any bundle claiming the same item id twice, with a BundleError naming the id and both claimant titles, before any write. Covered by 2 unit tests and an e2e test exercising both merge and replace modes."
acceptanceCriteria:
  - "`parseBundle` rejects a bundle containing the same item id at two positions with a `BundleError` naming the id, before any store access"
  - "`rex import-bundle` on such a bundle exits non-zero with \"Nothing was written to the PRD.\" and the tree is unchanged"
  - "A unit test constructs a duplicate-id bundle and asserts the rejection for both merge and replace modes"
description: "Verdict: should-fix (severity medium). Found by adversarial review of the portable-PRD-bundle branch diff.\n\nFailure scenario: `parseBundle` (packages/rex/src/core/prd-bundle.ts:290-372) validates field shapes via `validateDocument` but never checks id uniqueness across the items tree. A hand-edited or LLM-generated bundle with one id at two positions, imported with `--replace --yes`, produces a tree where two items claim one id: `findItem`/`update`/`remove` then resolve ambiguously, and `findTreeIdentityFaults` later reports the state with the misleading detail \"a merge may have unified two distinct items\". In merge mode the second occurrence surfaces as a bogus \"already exists locally\" collision. No file is lost (the serializer is positional-slug lossless by design — refutation partially found in folder-tree-serializer.ts's resolveSiblingSlugs doc), so this is an invariant breach rather than data loss.\n\nReachability: only via bundles not produced by `rex export` — but externally-authored bundles are a plausible artifact for this feature, and the module's own docblock promises strict validation before any write at exactly this trust boundary.\n\nSolution: a Set-based walk in `parseBundle` that throws `BundleError` naming the first duplicated id, before any write. ~10 lines plus one test; no risk."
lastModified: "2026-09-10T16:42:34.355Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
