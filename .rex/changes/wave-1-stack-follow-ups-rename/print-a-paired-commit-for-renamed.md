---
id: "8b43e6d0-b908-4f31-baca-b39827b88b72"
type: "task"
title: "Print a paired commit for renamed leftover paths"
slug: "print-a-paired-commit-for-renamed"
description: "PR #1004 review comment https://github.com/en-dash-consulting/n-dx/pull/1004#discussion_r4558509329. In packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts, 'if (renames.length > 0) return { renames };' withholds recovery for the whole group, so one rename removes the commands for every other leaked file. A commit naming both endpoints (git commit -m ... -- src/app.ts .rex/changes/ch/app.ts) lands R and RM renames cleanly and leaves an unrelated MM file's staged and unstaged bytes alone."
acceptanceCriteria:
  - "A refusal with a leaked rename prints a commit naming both endpoints, and no stash command for it."
  - "Non-rename leaked paths in the same refusal keep their normal recovery commands."
  - "Fail-forward in run.ts commits the rename pair instead of skipping it."
  - "Tests cover R and RM renames mixed with an unrelated MM path."
priority: "medium"
source: "ndx-capture"
---
