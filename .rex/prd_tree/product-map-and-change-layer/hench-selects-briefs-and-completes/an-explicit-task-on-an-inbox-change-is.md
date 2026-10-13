---
id: "360033a8-12a5-496d-b525-27695bd84d27"
level: "task"
title: "An explicit --task on an Inbox change is refused before the run, not reported completed"
status: "pending"
priority: "medium"
tags:
  - "pr-35"
  - "review-2026-10-13"
  - "lane-hench"
source: "review-2026-10-13"
acceptanceCriteria:
  - "ndx work --task=<Inbox change> on a v2 tree is refused up front naming placement (rex change place / place_change), and nothing runs (test that fails on the current head)"
  - "--resolve reports the same refusal"
  - "A placed change or its task is accepted as today; v1 is unchanged"
description: "Holistic review of the combined v2 stack, 2026-10-13 (hench area, should-fix). An explicit `--task` on an Inbox change reports a completed run, but rex refuses the completion (#692 Ryan, crossing #716)\n\n**Where.**\n- `packages/hench/src/agent/planning/brief.ts:291` (`resolveV2Entry`) through `rex resolveWorkById` (`change-selection.ts:155`). It accepts a `needsPlacement` change, and `explicitTaskRefusal` (`brief.ts:176`) checks only status.\n- `shared.ts:2850-2891` (`updateCompletedTaskStatus`) swallows rex's refusal as a `detail` warning.\n- `shared.ts:3485-3493` (`reportCompletionNotApplied`).\n\n**Scenario.**\n1. Run `ndx work --task=<an Inbox change>`.\n2. The agent works the change and asks to complete it, and the completion is held.\n3. The gate passes. `completeV2Work` throws \"Cannot complete change …: it still needs placement\" (`change-completion.ts:157`), and hench catches it.\n\n**Result.**\n- `run.status` is `completed`.\n- `completionHold.outcome` is `not-applied`.\n- The item stays `in_progress`.\n- hench prints \"The agent marked the task completed, but the run ended completed, so hench did not apply that completion\".\n- It commits \"chore(prd): commit PRD tree changes (task X completed)\", whose only content is `status: \"in_progress\"` in the Inbox `state.yaml`.\n\n**Evidence.** CONFIRMED by probe `PROBE3`.\n\n**Suggested fix.** Refuse an Inbox change up front in `explicitTaskRefusal` (and in `--resolve`) with \"place it first\". Separately, on v2, treat a rex completion refusal as a run failure rather than a diagnostics note."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T17:54:02.887Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
