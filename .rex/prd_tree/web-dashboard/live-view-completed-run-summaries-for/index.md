---
id: "c0325fd2-812d-4e13-833e-9daee5f0fe0b"
level: "feature"
title: "Live view: completed-run summaries for tasks and analyses"
status: "pending"
priority: "low"
tags:
  - "live"
  - "web-viewer"
  - "deferred"
source: "Live tab design session 2026-09-30 (deferred from the first cut); mockups https://claude.ai/artifact/AvLo4pyFzfs9HT2zZaCTE7"
acceptanceCriteria:
  - "A Live task or analysis link opened after the run ended shows the summary rather than a not-running state."
  - "Summaries only use data the run already recorded; no new LLM calls."
description: "Deferred from the first Live tab cut, which covers running work only and links finished runs to Work's run history. When a run ends, the Live task page and the Live analysis page should turn into a summary at the same URL, so a link shared while the run was going still answers \"how did it go\".\n\nGoal: The page someone was watching tells them the outcome when the run ends, without a second navigation."
lastModified: "2026-10-01T00:20:24.083Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Turn the Live analysis page into a what-changed summary when the analysis finishes](./turn-the-live-analysis-page-into-a.md) | pending |
| [Turn the Live task page into the run summary when the run finishes](./turn-the-live-task-page-into-the-run.md) | pending |
