---
id: "b571fb36-583c-450c-9e1a-1b5474a253de"
type: "task"
title: "Run classifier reads the hold outcome, files uncommitted-work refusals as held, and matches absolute digest paths"
slug: "run-classifier-reads-the-hold-outcome"
description: "Running hench runs diagnose on real failed runs (main checkout, sidecar-m1-core, sidecar-m2-drawer) found three defects in packages/hench/src/agent/analysis/run-verdict.ts. (1) completionHeld fires on any completionHold, but only outcome not-applied means the completion was held; applied and bypassed are not holds. (2) The completion gate refusing on uncommitted work (the DIRTY_TREE_REFUSAL branch of the claimLost rule) is a held completion, not a lost claim: real runs 5fbdbeb8 and 01c990df came out claim-lost, which the banner shows as a lost claim. Move that branch to completion-held, keeping its summary, its uncommitted-path evidence and its first action (commit or discard the uncommitted paths, then verify), and place it so it still wins over the other rules as today. claim-lost keeps claimLost and readOnlyRefusal. (3) DIGEST_FILE drops the leading slash of an absolute path, so normalizePath cannot strip the worktree root: run 25f37b78 reported Users/ryankeith/.../packages/web/tests/unit/viewer/add-item-form.test.ts as an unchanged file. An absolute digest path under worktreeRoot must normalize to its repo-relative form, so it matches a changed file at that path."
acceptanceCriteria:
  - "completion-held fires only for completionHold.outcome not-applied or gateOnlyRetry; a failed run whose completionHold outcome is applied or bypassed is classified by the other rules (unit tests for all three outcomes)"
  - "A completion-gate refusal on uncommitted work is classed completion-held, with the uncommitted paths as evidence and commit or discard them, then verify, as its first action; claim-lost covers only claimLost and readOnlyRefusal (tests use both refusal message formats)"
  - "An absolute path in the gate digest under the run worktreeRoot is reported repo-relative and matches a changed file at that path, so the run is test-gate-new (unit test with an absolute digest path)"
  - "The verdict section of docs/packages/hench.md and the changeset describe the corrected rules"
priority: "high"
source: "dogfood"
---
