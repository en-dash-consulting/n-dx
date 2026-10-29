---
id: "174ed214-01b5-40c2-b016-c0c21d89ca40"
type: "task"
title: "The duplicate-capture fix's `git add -u -- <rexDir>` stages unrelated tracked edits under the rex directory into the merge"
slug: "the-duplicate-capture-fix-s-git-add-u"
description: "Verdict: should-fix (severity low), from the adversarial review of task f2c90a0d.\n\nScenario: a worktree has an uncommitted edit to a tracked file under the rex directory that the merge does not touch (for example `.rex/config.json`, or `.rex/tree-meta.json` on v1). `git merge origin/main` starts anyway, because git only refuses dirty files the merge touches. Running the duplicate-capture fix's step 4, `git add -u -- .rex`, stages that edit, and the merge commit then carries it without the user choosing to include it.\n\nEvidence: packages/web/src/server/branch-health/conflicts.ts, duplicateCapture(), step `[\"git\", \"add\", \"-u\", \"--\", rexDir]`.\n\nReachable: GET /api/branch-health -> Workspaces strip -> a person copies and runs the duplicate-capture steps.\n\nOptions:\n(a) Stage only the PRD roots the repair writes: `<rexDir>/product` and `<rexDir>/changes` on v2, `<rexDir>/prd_tree` on v1 (chosen from the conflict path). First check how `git add -u` handles a pathspec that matches nothing, for example a v2 tree with no changes/ directory. Recommended.\n(b) Have `rex validate --post-merge --repair --format=json` list the files it rewrote, and stage exactly those. More precise, but the fix would no longer be a fixed list of steps."
acceptanceCriteria:
  - "With an unrelated tracked edit to .rex/config.json in the worktree, running the duplicate-capture fix's steps leaves that edit unstaged (integration test)"
  - "The fix's staging step still stages the state.yaml and blockedBy rewrites the repair made, on both v2 and v1 trees"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
