---
id: "03fd3c35-f82f-4939-9b63-09e97ff86ecc"
level: "task"
title: "Show target zones per connecting file row"
status: "completed"
priority: "high"
startedAt: "2026-07-16T14:25:07.397Z"
completedAt: "2026-07-17T15:09:39.925Z"
endedAt: "2026-07-17T15:09:39.925Z"
resolutionType: "code-change"
resolutionDetail: "SVG title tooltip on connecting file rows listing target zone names + call weights (weight-desc), resolved from rendered zones; 6 new unit tests"
acceptanceCriteria: []
description: "On each cross-zone file row in the expandable Zones graph, surface which other zones the file connects to and the call weight, using the existing fileConnections map (FileZoneLink[] with targetZoneId + weight) built by buildFileConnectionMap in packages/web/src/viewer/views/zones.ts. Render as an SVG title tooltip on the FileRow group listing each target zone name and weight. No new data plumbing required. Acceptance criteria: (1) Hovering a connecting file row shows a tooltip listing each target zone name and its call weight, sorted by weight descending. (2) Files with no cross-zone links show no tooltip/badge. (3) Target zone names resolve from the same zone list used to render the boxes (no unknown-zone labels)."
---
