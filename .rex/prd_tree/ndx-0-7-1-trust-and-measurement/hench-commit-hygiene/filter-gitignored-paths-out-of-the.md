---
id: "14c54655-2e03-4cfb-8af6-212b31ed9679"
level: "task"
title: "Filter gitignored paths out of the hench PRD staging list"
status: "completed"
priority: "high"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
  - "wm-2084"
  - "pr-k"
source: "caos work management: WM2084 (Filter gitignored paths out of the hench PRD staging list); follow-up from the guards run 2026-09-22, PR group K"
startedAt: "2026-09-22T04:28:33.527Z"
completedAt: "2026-09-22T04:28:33.527Z"
endedAt: "2026-09-22T04:28:33.527Z"
acceptanceCriteria:
  - "The execution log files are no longer in the staging list."
  - "A path that git check-ignore reports as ignored is skipped with a debug line, not staged, and does not abort the loop (unit test with an ignored fixture path)."
  - "A completion commit succeeds on a project whose .gitignore is the one rex init writes (integration test in completion-metadata-commit.test.ts)."
  - "The --reset-deferred commit path behaves the same."
description: "prdPathsToStage in packages/hench/src/agent/lifecycle/shared.ts (around line 1449) unconditionally includes .rex/execution-log.jsonl and .rex/execution-log.1.jsonl, while rex init (packages/rex/src/cli/commands/init.ts around line 76) writes .rex/execution-log*.jsonl into .gitignore. git add on an ignored path errors, the staging loop aborts, and no PRD path is staged, so the completion commit never happens. Two packages contradict each other, and this failed two of four autonomous runs in one session. The log is untracked by design, so it should never be in the list; add a git check-ignore filter beside the existing existence check so any future ignored path is skipped rather than fatal.\n\nImplementation notes: In packages/hench/src/agent/lifecycle/shared.ts, remove execution-log.jsonl and execution-log.1.jsonl from prdPathsToStage and add a filter that runs `git check-ignore --quiet -- <path>` (via the existing git exec helper) for each remaining candidate, dropping ignored paths with a debug log instead of passing them to git add. Keep the existence check. Cover both callers (commitCompletionMetadata and the reset-deferred commit). Add a unit test for the filter and an integration case in packages/hench/tests/integration/completion-metadata-commit.test.ts that initialises the fixture with rex init's .gitignore and asserts the completion commit lands. Changeset: @n-dx/hench patch. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T04:28:33.874Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
