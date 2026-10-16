---
id: "1c14cb3f-bcd7-456b-890d-b7b297e60a7e"
level: "task"
title: "Refresh the sourcevision analysis baseline the cut plan reads"
status: "pending"
priority: "high"
tags:
  - "pr-26"
  - "lane-migration"
  - "sourcevision"
source: "v2 migrate stack session 2026-10-15"
acceptanceCriteria:
  - "The analysis ran on the L5 tip with Jev on, and completed (analyze-progress.json)"
  - "Only files .sourcevision/ already tracks are committed; nothing from .sourcevision/.cache/"
  - "The rehearsal gate records this analysis (date and commit) as the one the plan read"
description: "Layer 6 of the v2 migrate stack (release N). Since #741 the migration plan draws code evidence from .sourcevision/, and the committed baseline is the 2026-09-28 analysis (#432): 601 evidence files, 10 of them deleted since. A fresh deep analysis with Jev, run on the L5 tip so it describes the code that ships, replaces it. Ryan runs it (his TypeSafe key comes from his vault); the session checks Jev ran (manifest.lastAnalysis, .sourcevision/.cache/analyses.jsonl, analyze-progress.json) and commits only the files .sourcevision/ tracks today, as chore(sourcevision): refresh the analysis baseline. No changeset: no package file changes. Decided by Ryan 2026-10-15 (fresh Jev-enabled analysis delivered with the stack)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T00:08:16.588Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
