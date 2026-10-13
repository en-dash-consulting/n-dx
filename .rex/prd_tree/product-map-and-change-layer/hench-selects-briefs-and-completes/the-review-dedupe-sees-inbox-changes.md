---
id: "5a9dca6c-69a5-420f-ac5f-e02fc00274e0"
level: "task"
title: "The review dedupe sees Inbox changes under changes/inbox/"
status: "completed"
priority: "medium"
tags:
  - "pr-35"
  - "review-2026-10-13"
  - "lane-hench"
source: "review-2026-10-13"
startedAt: "2026-10-13T18:05:54.362Z"
completedAt: "2026-10-13T18:14:14.957Z"
resolutionType: "code-change"
resolutionDetail: "Run 6129d508 committed e9f5a7f22 and 26ab6a593; its gate failed only on the stale prompt-census baseline, re-recorded in 52c23af56, after which the recorded gate (affected since 9349d6846) passed."
endedAt: "2026-10-13T18:14:14.957Z"
acceptanceCriteria:
  - "The review brief on a v2 tree tells the reviewer to look in both changes/ and changes/inbox/ (or the equivalent listing), and a test with an existing Inbox capture asserts it"
  - "The v1 review brief is unchanged"
description: "Holistic review of the combined v2 stack, 2026-10-13 (hench area, should-fix). The review pass's dedupe check cannot see Inbox changes (#692 Ryan, crossing #716)\n\n**Where.** `packages/hench/src/agent/analysis/adversarial-review.ts:444` and `:728` at #692 head. Both say \"list the directories under `.rex/changes/` and read the `index.md`\" of related ones. `reviewDedupeDir` is at `uncommitted-work-gate.ts:53`.\n\n**Defect.**\n- Since #716, unplaced changes live at `changes/inbox/<slug>/index.md`. `changes/inbox/` itself has no `index.md` and its slug matches no defect.\n- Unplaced review captures are exactly what the dedupe exists to find: an attended run's captures, every capture whose `place_change` was refused (finding 2.3), and any dashboard Quick Add. All of them sit one level below where the reviewer is told to look.\n- `review-dedupe-dir.test.ts` pins only the directory string.\n\n**Evidence.** CONFIRMED by trace. Probe `PROBE` showed `add_item` writing `.rex/changes/inbox/retry-soft-declines-twice/index.md`. That the reviewer then files a duplicate is PLAUSIBLE, since it depends on whether the model descends into the folder unprompted.\n\n**Suggested fix.** Add a v2 sentence to the dedupe instruction: \"…and under `changes/inbox/`, where unplaced changes wait\". Extend the dedupe test to a v2 fixture that has an Inbox change."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T18:14:15.299Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
