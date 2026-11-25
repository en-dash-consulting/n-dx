---
id: "044b9de7-6f19-401c-b094-291a2ad11dad"
type: "task"
title: "Exempt the version PR from Validate changesets in pull_request and merge_group"
slug: "exempt-the-version-pr-from-validate"
summary: "Teach the \"Validate changesets\" CI step to recognise the automatic release PR and skip it, in both the normal PR run and the merge queue, while still checking every other PR."
description: "Edit the \"Validate changesets\" step of the `build` job in .github/workflows/ci.yml (Linux leg, after \"Require changeset\"). Today it runs `pnpm exec changeset status --since=origin/main` unconditionally on Linux, and fails on the Changesets version PR because that PR deletes every `.changeset/*.md` while bumping package.json files.\n\nConstraints:\n- ci.yml triggers on `merge_group`. There `github.head_ref` is empty, so `github.head_ref != 'changeset-release/main'` alone is true in the queue and the step would still run and fail. The `on:` block comment requires any head_ref check to be gated on `github.event_name == 'pull_request'`.\n- Prefer a content check that works in every event: the branch deletes one or more `.changeset/*.md` files (excluding README.md) versus `origin/main` (three-dot diff, `git diff --diff-filter=D --name-only origin/main...HEAD -- '.changeset/*.md'`), adds none (`--diff-filter=A`), and no changeset .md other than README.md remains in the tree. Then it is a version PR: print a log line saying why it skips and exit 0; otherwise run `changeset status --since=origin/main` as today. You may combine this with an event-guarded head_ref check. The Build & Validate leg already checks out with fetch-depth 0, so origin/main is available under pull_request and merge_group.\n- Choose the approach and explain the choice, including the merge-queue reasoning, in the step's YAML comment.\n- If the shell grows past a few lines, move it into a small script under scripts/ (for example scripts/changeset-pr-checks.mjs, plain Node ESM, no new dependencies) with the decision logic in an exported pure function that takes the lists of added/deleted/remaining changeset paths, and a thin CLI that runs git. A script used only by ci.yml is fine in scripts/, as scripts/grammar-suites.mjs is. T2 will add the edited-changeset guard to the same script, so name it for both.\n- Do not touch \"Require changeset\", the job-level `if:`, the check names, or any other step. Do not add a changeset."
acceptanceCriteria:
  - "On a branch whose only changeset activity is deleting .changeset/*.md files (a version PR), Validate changesets skips with a log line under both pull_request and merge_group"
  - "The skip decision does not depend on github.head_ref unless that check is gated on github.event_name == 'pull_request'"
  - "A normal PR with a changeset naming a package that is not in the workspace still fails Validate changesets"
  - "On push to main the step still runs changeset status --since=origin/main"
  - "The step's comment explains the chosen detection and why a bare head_ref check would fail in the merge queue"
priority: "high"
tags:
  - "ci"
  - "release"
---
