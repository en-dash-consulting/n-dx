---
id: "96f49106-abcc-4a45-83ce-19b11f98875e"
level: "task"
title: "Fix suggestion in web-3: Zone \"web-3\" has a numeric suffix indicating an overflow community — pin its fil"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-19T03:14:05.033Z"
completedAt: "2026-04-19T03:24:10.348Z"
resolutionType: "config-override"
resolutionDetail: "Patched zones.json to remove web-3: moved views/index.ts to web-viewer (pinned zone), created web-sv-view-tests zone for the 2 test files. Matching pins already existed in .n-dx.json from commit c410e3ac. zones.json was stale (gitignored) and analyze process was stuck, so applied patch directly."
acceptanceCriteria: []
description: "- Zone \"web-3\" has a numeric suffix indicating an overflow community — pin its files to a named zone or merge with the base zone to eliminate the ambiguous ID"
recommendationMeta: "[object Object]"
---
