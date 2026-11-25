---
id: "2c091a65-08aa-4a78-a118-e12ce22ff80c"
type: "task"
title: "Move the changeset git diffs into ci.yml so the PR touches no package file"
slug: "move-the-changeset-git-diffs-into-ci"
summary: "Rework the new CI check so its helper script runs no commands itself, which keeps this pull request out of the published packages and lets it pass its own changeset checks without a release note."
description: "Follow-up to T1 (044b9de7, commit d48bc2779). T1's scripts/changeset-pr-checks.mjs imports node:child_process to run `git diff` and `pnpm exec changeset status`, so T1 also added an entry to packages/core/child-process-allowlist.json. That file lives under packages/core/, so `changeset status --since=origin/main` now reports \"Some packages have been changed but no changesets were found\" for THIS branch, and \"Require changeset\" would demand a changeset too. This PR must touch no package file and carry no changeset (an empty changeset stalls the Release run).\n\nDo this:\n- Remove the scripts/changeset-pr-checks.mjs entry from packages/core/child-process-allowlist.json, so `git diff origin/main...HEAD -- packages/` is empty on this branch.\n- Make scripts/changeset-pr-checks.mjs import nothing from node:child_process. Keep `isChangesetFile` and `classifyVersionPr({ added, deleted, remaining })` as exported pure functions. Its CLI takes the diff lists as input, for example `node scripts/changeset-pr-checks.mjs is-version-pr` reading newline-separated paths from env vars CHANGESET_ADDED and CHANGESET_DELETED (reading the remaining `.changeset/` entries with node:fs is fine), prints the reason line and exits 0 for a version PR, 1 otherwise. Choose a CLI shape T2 can extend with a second pure check (edited changesets) the same way.\n- In .github/workflows/ci.yml \"Validate changesets\", run the two `git diff --no-renames --diff-filter=A|D --name-only origin/main...HEAD -- '.changeset/*.md'` commands in the step's shell, pass their output to the script, skip with the script's log line when it says version PR, and otherwise run `pnpm exec changeset status --since=origin/main` directly in the step. Keep the existing comment's reasoning (content check, why a bare head_ref check fails under merge_group, push to main unaffected) and update the mention of where git runs. Keep `if: runner.os == 'Linux'`.\n- Do not touch \"Require changeset\", the job-level `if:`, check names or other steps. Do not add a changeset."
acceptanceCriteria:
  - "packages/core/child-process-allowlist.json is identical to origin/main, and `git diff --name-only origin/main...HEAD -- packages/` is empty"
  - "scripts/changeset-pr-checks.mjs does not import node:child_process and still exports isChangesetFile and classifyVersionPr"
  - "On this branch `pnpm exec changeset status --since=origin/main` no longer reports changed packages"
  - "Validate changesets still skips a branch that only deletes changesets and leaves none, under pull_request and merge_group, and still runs changeset status on every other branch and on push to main"
  - "tests/e2e/architecture-policy.test.js passes"
priority: "high"
tags:
  - "ci"
  - "release"
---
