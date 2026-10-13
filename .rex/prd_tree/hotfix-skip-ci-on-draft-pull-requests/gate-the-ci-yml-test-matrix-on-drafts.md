---
id: "4e0b0cd2-72cd-4410-b1ee-b06c1ee7fd3f"
level: "task"
title: "Gate the ci.yml test matrix on drafts, and make the policy test cover every job"
status: "pending"
priority: "critical"
tags:
  - "hotfix"
  - "ci"
  - "github-actions"
acceptanceCriteria:
  - "ci.yml `test` job carries the same job-level draft/ci:run gate as `build` and `smoke-parity`; its name, matrix and steps are unchanged"
  - "tests/e2e/ci-draft-pr-gate.test.js discovers jobs from each workflow's `jobs:` block instead of a hand-written list, and fails when any job lacks the gate"
  - "Removing the `test` job's `if:` makes the test fail naming that job (checked locally, then restored)"
  - "ci-draft-pr-gate, ci-merge-queue-trigger, cli-dev and scheduler-startup tests pass"
run: {"tier":"light"}
description: "Found 2026-10-13 checking the draft gate on main. The gate works for the jobs it names: on draft PRs (#687, #705–#710) `build` (shown as `matrix.name`) and `CLI Smoke Parity` report skipped. But the CI wall-time stack (834c793ae \"run the test suites as nine parallel jobs\") landed on main afterwards and added a `test` job, \"Tests (<Linux|macOS|Windows>, <group>)\", with no `if:`. Every draft push still runs all nine, three of them on macOS, which is most of the minutes the hotfix was meant to save (e.g. run 38336706893 on draft #687, run 38328412343 on draft #710).\n\nIt is worse than a draft leak: ci.yml now triggers on `labeled`, so adding ANY label to ANY PR starts a run where `test` runs all nine jobs. Its noop concurrency group means it does not cancel the PR's real run, so it doubles it.\n\ntests/e2e/ci-draft-pr-gate.test.js did not catch this because it lists job names by hand (`{ file: \"ci.yml\", jobs: [\"build\", \"smoke-parity\"] }`).\n\nEdits:\n1. .github/workflows/ci.yml: give the `test` job the same job-level `if: >-` block as `build` and `smoke-parity` (non-PR events always run; a PR event runs when ready, except `labeled`, which runs only for `ci:run` on a draft). Copy it exactly; one short comment pointing at the explanation above `build`'s gate rather than repeating it. Do not change the job's name, matrix or steps.\n2. tests/e2e/ci-draft-pr-gate.test.js: stop hand-listing jobs. Derive the job ids from each workflow's top-level `jobs:` block (two-space-indented keys under `jobs:`, the same text-slicing style the file already uses, CRLF already normalized on read) and assert every job carries the gate. That way a job added later fails the test until it is gated. Keep codeql.yml and dependency-review.yml covered the same way. If a future job must legitimately run on drafts, an explicit allowlist with a comment is the escape hatch; there is none today.\n3. Prove the test bites: temporarily delete the `test` job's `if:` locally, confirm the test fails naming `test`, restore it. Say in the summary that you did this.\n\nBranch: hotfix/draft-pr-ci-gate-test-jobs (this worktree), from main. No changeset (no packages/ source). Run `pnpm vitest run tests/e2e/ci-draft-pr-gate.test.js tests/e2e/ci-merge-queue-trigger.test.js` and the required tests tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js."
lastModified: "2026-10-13T02:35:43.734Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
