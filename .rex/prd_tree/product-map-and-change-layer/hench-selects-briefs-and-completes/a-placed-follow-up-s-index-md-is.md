---
id: "b5a52c01-e2c1-439d-800e-d930bef52aa4"
level: "task"
title: "A placed follow-up's index.md is committed with its completion on v2"
status: "pending"
priority: "high"
tags:
  - "pr-35"
  - "review-2026-10-13"
  - "lane-hench"
source: "review-2026-10-13"
acceptanceCriteria:
  - "The PROBE4 scenario as a test: a change written and placed through MCP after the agent's commit, then selected and completed by a later run, has both its index.md and state.yaml in the completion commit (test that fails on the current head)"
  - "Report-only staging still leaves unrelated dirty changes/ and product/ files out of the completion commit (existing 1672bb20 test passes unedited)"
  - "v1 staging is unchanged"
description: "Holistic review of the combined v2 stack, 2026-10-13 (hench area, should-fix). Completing a follow-up that the agent placed commits its `state.yaml` without its `index.md` (#692 Ryan, crossing #716 and #725)\n\n**Where.** `packages/hench/src/agent/lifecycle/shared.ts:2447` at #692 head (`const scope = report ?? (isV2 ? { written: [], deleted: [] } : null)`, from 748b439c0). The save report itself is `packages/rex/src/store/change-layer-store.ts:86` (#690). It lists only the files a write changed.\n\n**Scenario.** This is the normal flow #725 now asks for.\n1. In run 1 the agent (or the review pass) captures a follow-up with `add_item`. The capture is written to `changes/inbox/<slug>/` (#716). The agent then calls `place_change` (#725's step 9 and review line), which moves it to `changes/<slug>/index.md`. Both writes come from the MCP server process, after the agent's own commit (step 9 follows step 8, and the review runs after the agent). No hench save report covers them, so they stay untracked, and the pre-run gate discounts `changes/` silently.\n2. In run 2 (the next `--loop` iteration, or the next `ndx work`) the placed follow-up is selected. Selection excludes only `needsPlacement` changes. The held completion is applied after the gate. The writer changes only `changes/<slug>/state.yaml`, so that is the only file in the report.\n3. The completion commit \"chore(prd): commit PRD tree changes (task X completed)\" lands `state.yaml` alone. `index.md` stays untracked.\n\n**Result.** HEAD holds a completed state row for a node git does not have. A clone, a merge, or a worktree cleaned up after its PR merges reads an orphan state row: the reader warns, and the change, its intent and its touches are gone.\n\nOn v1 this cannot happen, because status lives in `index.md` frontmatter. Any completion rewrites that file, so it is reported and staged. Splitting status into `state.yaml` is what makes report-only staging lose the intent file.\n\n**Evidence.** CONFIRMED by probe `PROBE4`:\n\n```\nlast commit:  .rex/changes/log-slow-card-gateways/state.yaml | 9 +++++++++   (only file)\nls-files:     .rex/changes/log-slow-card-gateways/state.yaml (no index.md)\ndirty after:  ?? .rex/changes/log-slow-card-gateways/index.md\nrun: completed / completionHold applied\n```\n\nThe run's own end-of-run commit gate does emit \"1 path(s) left uncommitted\". Nothing stops the run, though, and the next pre-run gate discounts the path.\n\n**Suggested fix.** When the report names a v2 `state.yaml`, also stage the intent files of the nodes whose rows it wrote, if they are untracked or modified. Alternatively, have `ChangeLayerStore`'s report include the node folder's `index.md` for every node whose state row changed. Add the PROBE4 scenario as a test. It does not block merging the stack, because no v2 tree exists before the cut. It does block the cut."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T17:53:55.307Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
