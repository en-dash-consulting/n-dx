---
id: "5d477a38-78b5-4e60-8024-b00770b5cb34"
type: "task"
title: "A late first-page Ready to run reply overwrites the full list after Show all"
slug: "a-late-first-page-ready-to-run-reply"
description: "Verdict: out-of-scope (low). It predates 3adf86fa and was introduced with the paging in 7228da35c.\n\nScenario: a hench-runs live refresh fires while the list is collapsed, so load() sends limit=50&offset=0. The user then clicks Show all (or types a search), and load() sends all=1. If the 50-row reply lands after the full one, setTasks replaces the full list with 50 rows. The expanded list, its search and its filters then cover only those 50 rows, while total still reads N. This lasts until the next load. Reach: the Work page, packages/web/src/viewer/components/ready-to-run.ts load(). It needs a run frame inside the click window, so the window is narrow.\n\nOptions:\n(a) A request sequence ref: load() bumps it and drops a reply that is not the latest. One ref and a test.\n(b) An AbortController per load that aborts the previous fetch.\nRecommend (a)."
acceptanceCriteria:
  - "When a first-page ready request resolves after a later all=1 request, the list keeps every row from the all=1 reply (viewer test with deferred fetch resolution)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
