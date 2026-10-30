---
id: "f2c90a0d-ac38-4bdf-9bfb-45fe667160ec"
type: "task"
title: "The duplicate-capture fix names no rex command that removes the dropped copy, so this branch's id can linger in state.yaml"
slug: "the-duplicate-capture-fix-names-no-rex"
description: "Verdict: should-fix (severity medium), from the adversarial review of task d62623bb.\n\nScenario: on a v2 tree, both branches capture \"Add a widget\" under the same change. The item file has the same path on both sides, with different ids (base: B, this branch: X): an add/add conflict, classed duplicate-capture. The offered fix is `git checkout --theirs -- <path>`, `git add`, `rex validate --post-merge`. It keeps B, but X's row in that change's state.yaml (and any blockedBy pointing at X) stays behind. `rex validate --post-merge` scans only the v1 prd_tree, so on v2 it reports nothing. The task's criterion asked for \"the rex command that removes the other copy\". The fix only names one in its prose reason, and that command (`rex remove X`) cannot run after the checkout, because X's file is gone.\n\nEvidence: packages/web/src/server/branch-health/conflicts.ts, duplicateCapture().\n\nReachable: GET /api/branch-health -> Workspaces strip, on any v2 project where two worktrees capture the same title.\n\nOptions:\n(a) Add a rex command that prunes state rows and blockedBy references to ids missing from the tree (for example `rex validate --repair` on v2), and make it the fix's last step. Cost: a rex change plus tests. Recommended.\n(b) Run `rex remove X --yes` before the checkout, which needs rex to load a tree whose file has conflict markers. It cannot today.\n(c) Keep the steps and say in the reason which command cleans up by hand. Cheapest, but nothing would run the cleanup."
acceptanceCriteria:
  - "After running a duplicate-capture fix's steps on a v2 temp repo where both branches captured the same title, no state.yaml row and no blockedBy names the dropped id (integration test)"
  - "The duplicate-capture fix's steps include a rex command that removes or prunes the dropped copy's id, and it exits 0 on that repo"
  - "On v2, the fix's validation step reports a leftover reference to the dropped id when one is planted (test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
