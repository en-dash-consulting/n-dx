---
id: "dba4ef37-fe97-4e87-b87f-d8d67b10ed63"
level: "task"
title: "Keep a completed task completed when only the record commit fails"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
  - "wm-2085"
  - "pr-c"
blockedBy:
  - "14c54655-2e03-4cfb-8af6-212b31ed9679"
source: "caos work management: WM2085 (Keep a completed task completed when only the record commit fails); follow-up from the guards run 2026-09-22, PR group C"
acceptanceCriteria:
  - "A record-commit failure after a successful task leaves the PRD status completed and the code commits intact (integration test that makes the record commit fail)."
  - "withdrawCompletionClaim is not called on that path; the claim is still released."
  - "The run record carries recordCommitPending with the paths, as an optional field that old records do not need."
  - "The CLI prints 'work committed; record not committed' with `git add -- <paths>` and `git commit -- <paths>` limited to the reported paths."
  - "A genuine task failure still fails the run exactly as before."
description: "packages/hench/src/agent/lifecycle/shared.ts (around line 2710) sets the run status to failed and calls withdrawCompletionClaim when the PRD metadata commit fails, even though the code, the review repairs and the tests have already landed and passed. The withdrawal responds to 'I cannot commit PRD state' by writing more PRD state through the same path that just failed, leaving the tree dirtier than the failure did. The invariant is sound: an uncommitted 'completed' is a rumour. The remedy is wrong: it should be a warning plus a recorded 'record commit pending' condition, not a rollback. In 0.7.1: on a record-commit failure keep the completed status, do not withdraw, mark the run outcome as completed with the record uncommitted, set an optional recordCommitPending field on the run record, and print the exact path-scoped commands that would commit the record. Making that condition resumable and visible in the dashboard is 0.9.0 work with the other run-record changes.\n\nImplementation notes: In packages/hench/src/agent/lifecycle/shared.ts, split the post-completion failure handling: a failure inside the metadata commit (commitCompletionMetadata returning an error) must not set run.status to failed and must not call withdrawCompletionClaim. Instead record an optional recordCommitPending: { paths, error } on the run record (additive in packages/hench/src/schema/v1.ts, old records must validate), keep the claim release, and emit a warning with the path-scoped recovery commands (reuse the formatter from the uncommitted-work gate so the commands are scoped). Leave the run summary wording to the companion summary item but make sure the outcome value it reads distinguishes the two cases. Add an integration test that stubs the record commit to fail and asserts status, claim release and the record field. Changeset: @n-dx/hench patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T02:47:35.067Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
