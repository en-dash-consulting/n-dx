---
id: "7da57492-972c-4244-bf1e-fe72f37a16e0"
level: "feature"
title: "Surface per-file cross-zone connections in the expandable Zones graph"
status: "completed"
priority: "medium"
startedAt: "2026-07-24T19:40:05.959Z"
completedAt: "2026-07-24T19:40:05.959Z"
endedAt: "2026-07-24T19:40:05.959Z"
acceptanceCriteria: []
description: "The Zones graph already lets a user expand a zone node to reveal its file rows and flags files that bridge zones with an indicator bar (buildFileConnectionMap, FileRow cg-file-xzone-bar in packages/web/src/viewer/views/zones.ts). But the UI only shows THAT a file connects out, not WHICH zones or how strongly, and bridging files can hide in the '+N more' overflow (FILE_ROWS_MAX=15, unsorted). This feature completes the 'expand a node to see the files connecting to other zones' experience by surfacing each file's target zones and call weights, prioritizing/filtering connecting files, drawing a file's connections on hover/select even when the target is collapsed, and color-coding the indicator bar by target zone. The FileZoneLink data (targetZoneId + weight) already exists in fileConnections; most work is UI surfacing, not new data plumbing."
---

## Children

| Title | Status |
|-------|--------|
| [Add tests for cross-zone connection surfacing and file ordering](./add-tests-for-cross-zone-6042f1.md) | completed |
| [Color-code the cross-zone indicator bar by target zone](./color-code-the-cross-zone-d593c6.md) | completed |
| [Highlight a file's cross-zone connections on hover or select](./highlight-a-file-s-cross-zone-06071f.md) | completed |
| [Prioritize and optionally filter connecting files in an expanded zone](./prioritize-and-optionally-f9c648.md) | completed |
| [Show target zones per connecting file row](./show-target-zones-per-03fd3c.md) | completed |
