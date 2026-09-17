---
id: "d593c618-3430-4a92-af3a-7b9b126e314d"
level: "task"
title: "Color-code the cross-zone indicator bar by target zone"
status: "completed"
priority: "low"
startedAt: "2026-07-24T19:36:27.399Z"
completedAt: "2026-07-24T19:40:05.056Z"
endedAt: "2026-07-24T19:40:05.056Z"
resolutionType: "code-change"
resolutionDetail: "Indicator bar now renders weight-proportional stacked segments colored per target zone (buildXZoneBarSegments), matching zone box colors; single accent bar remains as fallback when no target resolves. 4 new unit tests."
acceptanceCriteria: []
description: "Replace the single-color cg-file-xzone-bar in the FileRow component (packages/web/src/viewer/views/zones.ts) with a bar colored/segmented by the target zone(s) the file connects to, using each zone's color from the zone list. Multi-target files show proportional stacked segments. Acceptance criteria: (1) A file connecting to one zone shows a bar in that zone's color. (2) A file connecting to multiple zones shows proportional segments per target zone color. (3) Bar colors match the corresponding zone box colors."
---
