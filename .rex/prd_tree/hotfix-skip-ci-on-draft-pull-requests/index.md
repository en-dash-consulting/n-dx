---
id: "d94e33aa-d512-41c7-88fb-20d7557d2d5b"
level: "epic"
title: "Hotfix · Skip CI on draft pull requests"
status: "pending"
priority: "critical"
tags:
  - "hotfix"
  - "ci"
  - "github-actions"
  - "cost"
source: "ndx-capture"
startedAt: "2026-10-12T19:33:36.584Z"
endedAt: "2026-10-12T19:33:36.584Z"
description: "We are running out of GitHub Actions build minutes. Every push to a draft PR runs the full CI matrix (ubuntu + macOS + Windows; macOS bills at 10x Linux), plus CodeQL and Dependency Review. Drafts cannot merge, so those runs buy nothing.\n\nFix: gate each PR-triggered job on the PR not being a draft, and add the `ready_for_review` trigger type so the full run fires the moment a PR is marked ready.\n\nWorkflows that run on pull_request today:\n- .github/workflows/ci.yml: jobs `build` (matrix: \"Build & Validate\", \"CLI Smoke (macOS)\", \"CLI Smoke (Windows)\") and `smoke-parity` (\"CLI Smoke Parity\", needs build). Also triggers on push to main and merge_group.\n- .github/workflows/codeql.yml: job `analyze`. Also push to main and a weekly schedule.\n- .github/workflows/dependency-review.yml: job `dependency-review`. pull_request only.\ndocs.yml and release.yml do not run on PRs and are out of scope.\n\nTHE TRAP (read before editing): `if: github.event.pull_request.draft == false` alone is wrong for ci.yml and codeql.yml. On push, merge_group and schedule events `github.event.pull_request` is null, `null == false` is false, and the job would be SKIPPED on main and in the merge queue. The merge queue would then wait forever on its required checks. Use:\n  if: github.event_name != 'pull_request' || github.event.pull_request.draft == false\n\nTrigger types: replace the bare `pull_request:` with\n  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]\nThe first three are GitHub's default set, so nothing that runs today stops running. `converted_to_draft` starts a run whose jobs all skip; in ci.yml the existing `concurrency: ci-${{ github.ref }}` with cancel-in-progress then cancels the in-flight full run, which saves the rest of its minutes.\n\nBilling: a job whose job-level `if:` is false never gets a runner and is not billed. The workflow run still appears in the Actions tab with skipped jobs; that is expected.\n\nRequired checks: for a draft PR the matrix job is skipped before expansion, so the required checks (\"Build & Validate\", the two smoke legs, \"CLI Smoke Parity\") show as Expected/pending instead of passing. That is fine (a draft cannot merge) and they report once the PR is marked ready. Do not rename any job or check name; tests/e2e/ci-merge-queue-trigger.test.js pins them.\n\nConventions (every task in this epic):\n- Branch: hotfix/draft-pr-ci-gate (this worktree), cut from main. One PR for the epic.\n- Workflow and test edits only. No package source changes, so no changeset (ci.yml's \"Require changeset\" step skips PRs that touch no packages/ source). Do not add an empty changeset.\n- Read workflows as text in tests, no YAML dependency, matching tests/e2e/ci-merge-queue-trigger.test.js.\n- Keep the existing comment style in the workflow files: a short comment above the new `if:` and `types:` saying why.\n- Before declaring done run `pnpm vitest run tests/e2e/ci-merge-queue-trigger.test.js tests/e2e/ci-draft-pr-gate.test.js` and the required tests tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js."
lastModified: "2026-10-12T19:41:43.446Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Gate ci.yml build and smoke-parity jobs on non-draft pull requests](./gate-ci-yml-build-and-smoke-parity.md) | completed |
| [Gate CodeQL and Dependency Review on non-draft pull requests](./gate-codeql-and-dependency-review-on.md) | completed |
| [Policy test: PR-triggered workflow jobs skip drafts without skipping main or the merge queue](./policy-test-pr-triggered-workflow-jobs.md) | completed |
| [Manual CI for draft PRs: a one-shot ci:run label and a Run workflow button](./manual-ci-for-draft-prs-a-one-shot-ci.md) | pending |
