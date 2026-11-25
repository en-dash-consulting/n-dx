---
id: "bbe2e8e7-cdc3-467a-a8a7-90ee8e90978b"
type: "task"
title: "Fail a PR that edits a changeset already on main"
slug: "fail-a-pr-that-edits-a-changeset"
summary: "Add a CI guard that stops a pull request from editing a release note that is already on main, because the next release may delete that note and the edit would be lost or cause a conflict."
description: "Add a Linux-only step to the `build` job (Build & Validate) in .github/workflows/ci.yml, next to \"Require changeset\" and \"Validate changesets\", named for example \"Forbid edits to existing changesets\".\n\nWhy: after 0.10.5 shipped, PR #1094 hit a modify/delete conflict on .changeset/hench-php-guards.md. It had edited a changeset already on main; the release consumed and deleted that file, so the edit would never have been released. A PR must add its own changeset files and never modify one already on main.\n\nCheck: `git diff --diff-filter=MR --name-only origin/main...HEAD -- '.changeset/*.md'` (README.md excluded). Non-empty means fail with exit 1 and a message that lists the files and says to add a new changeset instead (`pnpm changeset`), because a changeset already on main may be consumed by the next release. Deletions (the version PR) and additions must pass.\n\nEvents: the three-dot diff against origin/main works under pull_request, merge_group (HEAD is the queue's merge commit) and push to main (empty diff), and the Linux leg checks out with fetch-depth 0. So run it in every event rather than gating on pull_request, and say so in the step comment; if you do gate it, state the reason in the comment. Never condition it on github.head_ref without an event_name == 'pull_request' guard.\n\nWhere the code goes: scripts/changeset-pr-checks.mjs already holds the version-PR check as a pure function (classifyVersionPr) with git run in the ci.yml step shell. Follow the same split: run `git diff` in the step's shell and pass the output to a new subcommand of that script backed by an exported pure function (e.g. findEditedChangesets(paths) returning the offending changeset files, plus the message). The script must NOT import node:child_process, and do not edit anything under packages/ (packages/core/child-process-allowlist.json included): this PR must touch no package file so it needs no changeset. Do not change the Validate changesets exemption, \"Require changeset\", the job-level `if:` or the check names. Do not add a changeset."
acceptanceCriteria:
  - "A PR that modifies or renames a .changeset/*.md file present on origin/main fails Build & Validate, and the message names each file and says to add a new changeset because one already on main may be consumed by the next release"
  - "A PR that only adds changeset files passes the guard"
  - "The version PR, which only deletes changeset files, passes the guard"
  - "The guard runs under merge_group and push to main, or is gated to pull_request with the reason stated in its comment"
  - ".changeset/README.md is not treated as a changeset"
  - "scripts/changeset-pr-checks.mjs still imports nothing from node:child_process, and `git diff --name-only origin/main...HEAD -- packages/` stays empty"
priority: "high"
tags:
  - "ci"
  - "release"
blockedBy:
  - "044b9de7-6f19-401c-b094-291a2ad11dad"
  - "2c091a65-08aa-4a78-a118-e12ce22ff80c"
---
