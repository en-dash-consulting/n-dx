---
id: "84816b03-8d23-4078-8b72-7783d2484de5"
level: "task"
title: "Stage only the files the serializer wrote in hench completion and reset-deferred commits"
status: "completed"
priority: "medium"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
  - "wm-2040"
blockedBy:
  - "9eaa9ac9-a4ff-47bf-89d6-4c15542a7200"
source: "caos work management: WM2040 (Stage only the files the serializer wrote in hench completion and reset-deferred commits); 0.7.1 execution plan PR group"
startedAt: "2026-09-23T18:59:51.662Z"
completedAt: "2026-09-23T18:59:51.662Z"
endedAt: "2026-09-23T18:59:51.662Z"
resolutionType: "code-change"
resolutionDetail: "commitPrdTreeIfStaged and its two callers (commitCompletionMetadata, commitResetDeferredChanges) build the git add list and commit pathspec from the store's SaveFileReport plus tree-meta.json, with existence checks on written paths and tracked-only staging of deletions; wholesale fallback when a store does not report. Integration tests: unrelated dirty prd_tree file stays out and stays dirty on both paths, deletions staged, real-store end-to-end minimal commit. PR C branch feat/hench-commit-hygiene-pr-c."
acceptanceCriteria:
  - "packages/hench/tests/integration/completion-metadata-commit.test.ts gains a case where an unrelated dirty file under .rex/prd_tree/ exists during completion and is not in the completion commit and remains dirty afterwards."
  - "The --reset-deferred commit path has the same test."
  - "Existing tests for operator-staged work still pass unchanged."
  - "A real ndx work completion commit on a fixture project touches only the completed item's file(s) and its parent's index.md."
description: "packages/hench/src/agent/lifecycle/shared.ts commitPrdTreeIfStaged (around line 1495) stages all of .rex/prd_tree/ plus .rex/tree-meta.json, and both commitCompletionMetadata (task completion) and the --reset-deferred commit path use it. Staging the whole directory once swept a 1,378-file in-flight rename into a 'task completed' commit. Stage the exact list of paths the serializer reports written and deleted for that save, plus tree-meta.json, keeping the existing existence checks (git add errors on a missing path) and the pathspec on the commit so operator-staged work outside those paths is left alone.\n\nImplementation notes: Change commitPrdTreeIfStaged and its two callers (commitCompletionMetadata and the --reset-deferred commit) in packages/hench/src/agent/lifecycle/shared.ts to build the git pathspec from the serializer's reported written and deleted paths for the save that just happened, plus .rex/tree-meta.json, instead of `.rex/prd_tree`. Keep the per-path existence check and the pathspec on `git commit`. Thread the file list from the store save result through the rex gateway (see the companion work item that exposes it). Add the two integration tests described in the acceptance criteria to packages/hench/tests/integration/completion-metadata-commit.test.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T18:59:52.464Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
