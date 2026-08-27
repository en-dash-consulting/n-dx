---
id: "0ba847e0-e5f4-4e0d-8786-2866cbd283a4"
level: "task"
title: "Include cache tokens in the run summary's input figure"
status: "pending"
priority: "medium"
tags:
  - "review-pass"
  - "e2e-finding"
  - "token-accounting"
  - "severity:medium"
source: "ndx-capture"
acceptanceCriteria:
  - "The run summary's input figure includes cacheCreationInput and cacheReadInput, or shows them as separate labelled lines"
  - "A resumed-session review run displays an input total consistent with the stored run record"
  - "ndx usage and the dashboard per-item rollup are checked for the same omission and fixed if present"
  - "A unit test asserts the displayed input total equals the sum of all four token fields"
description: "Run 60c3a951's summary printed:\n\n    tokens_in:      319\n    tokens_out:   42,733\n\nwhile the stored run record held `{\"input\":319,\"output\":42733,\"cacheCreationInput\":553572,\"cacheReadInput\":14740617}`. True input was ~15.29M tokens; the headline said 319. Four orders of magnitude out.\n\nThis matters most for exactly this feature. A resumed reviewer re-reads the whole work session, so its cost is almost entirely cache reads — the 14.7M figure is the review pass's dominant cost and the part a user deciding whether --review is affordable needs to see. Displaying 319 makes review look free, which is the opposite of the intent noted at cli-loop.ts:1159-1161 (\"leaving it out would make --review look free in ndx usage\").\n\nThe charging is correct — cache fields are stored and the review is folded into the run total. Only the display drops them.\n\nCheck whether `ndx usage` and the dashboard's per-item rollup have the same omission, since they read the same records."
lastModified: "2026-08-27T16:48:50.485Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
