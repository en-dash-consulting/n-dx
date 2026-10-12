---
id: "52c19495-4471-4159-8bd9-21afc24ebe6d"
level: "task"
title: "Gate ci.yml build and smoke-parity jobs on non-draft pull requests"
status: "completed"
priority: "critical"
tags:
  - "hotfix"
  - "ci"
  - "github-actions"
startedAt: "2026-10-12T19:13:39.354Z"
completedAt: "2026-10-12T19:20:37.368Z"
endedAt: "2026-10-12T19:20:37.368Z"
resolutionType: "code-change"
resolutionDetail: "ci.yml: pull_request types + job-level non-draft if on build and smoke-parity"
acceptanceCriteria:
  - "ci.yml `pull_request:` lists types opened, synchronize, reopened, ready_for_review, converted_to_draft"
  - "`build` and `smoke-parity` each carry a job-level `if: github.event_name != 'pull_request' || github.event.pull_request.draft == false`"
  - "push (main) and merge_group triggers are unchanged and their jobs still run (no bare `pull_request.draft == false` condition anywhere)"
  - "Job and check names are unchanged and tests/e2e/ci-merge-queue-trigger.test.js still passes"
  - "No files outside .github/workflows/ci.yml are modified by this task"
run: {"tier":"light"}
description: "Edit .github/workflows/ci.yml only (the test lives in the sibling task).\n\n1. In the top-level `on:` block, give `pull_request:` an explicit `types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]`. Leave `push:` (branches: [main]) and `merge_group:` and their comments as they are.\n2. Add to the `build` job (job level, beside `runs-on`):\n   if: github.event_name != 'pull_request' || github.event.pull_request.draft == false\n   Do NOT use `github.event.pull_request.draft == false` alone: on push and merge_group the PR context is null, the expression is false, and main CI and the merge queue would stop running.\n3. Add the same `if:` to `smoke-parity`. It already `needs: build` and would skip when build skips, but the explicit gate keeps the intent readable and survives a future `if: always()`.\n4. Leave step-level conditions alone (e.g. the \"Require changeset\" step's `github.event_name == 'pull_request'` guard).\n5. Comments: one short comment above `types:` (why ready_for_review and converted_to_draft are there, and that the first three are GitHub's default set) and one above the `build` job's `if:` (drafts cannot merge; skipped jobs get no runner and are not billed; the null-PR trap on push/merge_group)."
lastModified: "2026-10-12T19:20:38.969Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
