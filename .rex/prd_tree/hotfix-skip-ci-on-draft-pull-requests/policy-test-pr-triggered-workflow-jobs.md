---
id: "bde44f34-f15f-4e2c-8a9e-82f400814305"
level: "task"
title: "Policy test: PR-triggered workflow jobs skip drafts without skipping main or the merge queue"
status: "pending"
priority: "high"
tags:
  - "hotfix"
  - "ci"
  - "tests"
blockedBy:
  - "52c19495-4471-4159-8bd9-21afc24ebe6d"
  - "efc173f4-fcbd-4da9-b152-9f3ca22ab4af"
acceptanceCriteria:
  - "tests/e2e/ci-draft-pr-gate.test.js exists, uses no YAML library, and passes"
  - "The test fails if any of the four jobs loses its draft gate or its github.event_name guard"
  - "The test fails if a pull_request `types:` list drops ready_for_review, converted_to_draft, opened, synchronize or reopened"
  - "tests/e2e/ci-merge-queue-trigger.test.js, tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js pass"
run: {"tier":"light"}
description: "Add tests/e2e/ci-draft-pr-gate.test.js. Read the workflow files as text with no YAML dependency, following tests/e2e/ci-merge-queue-trigger.test.js (reuse its `onBlock` approach; copy the helper, do not export it from the other test).\n\nCover ci.yml, codeql.yml and dependency-review.yml:\n- `pull_request:` has a `types:` line containing ready_for_review and converted_to_draft, and still contains opened, synchronize and reopened (dropping one of those would silently stop CI on new pushes).\n- Each named job (ci.yml `build` and `smoke-parity`, codeql.yml `analyze`, dependency-review.yml `dependency-review`) has a job-level `if:` that contains both `github.event_name != 'pull_request'` and `github.event.pull_request.draft == false`.\n- Regression guard for the trap: no `if:` line in ci.yml or codeql.yml checks `pull_request.draft` without also checking `github.event_name`. Comment in the test why: on push/merge_group/schedule the PR context is null and a bare draft check would skip main CI and stall the merge queue.\n\nExtract a job's block by finding `^  <job>:` and reading to the next two-space-indented key, the same text-slicing style as the existing test. Keep the file short.\n\nThen run the commands listed in the epic's conventions."
lastModified: "2026-10-12T19:08:57.874Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
