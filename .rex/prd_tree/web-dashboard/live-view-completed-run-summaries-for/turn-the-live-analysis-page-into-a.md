---
id: "818f80c9-8853-4e82-bf16-5d0c7cd2bb1f"
level: "task"
title: "Turn the Live analysis page into a what-changed summary when the analysis finishes"
status: "pending"
priority: "low"
tags:
  - "live"
  - "web-viewer"
  - "sourcevision"
  - "deferred"
blockedBy:
  - "da9227aa-3b7a-449f-80af-a99f94975c1a"
acceptanceCriteria:
  - "The summary lists zone and finding changes against the previous analysis of the same worktree."
  - "Background narration shows its status until it ends."
  - "No new LLM calls; differences are computed from the analysis files on disk."
description: "At `/live/analyze`, once the analysis has finished: what changed since the previous analysis (zones added, merged or renamed; findings added and resolved by severity; file and import counts), time per phase against the previous run, and model spend from `manifest.lastAnalysis`. If background narration started for escalated zones, show it as a second item with its status from `manifest.narration`. Link to the Analysis stage pages for the details."
lastModified: "2026-10-01T00:21:32.455Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
