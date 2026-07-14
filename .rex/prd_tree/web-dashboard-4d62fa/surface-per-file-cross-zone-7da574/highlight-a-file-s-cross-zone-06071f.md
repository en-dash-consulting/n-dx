---
id: "06071f9a-6d4f-4df6-9800-0a0ab2d95d0f"
level: "task"
title: "Highlight a file's cross-zone connections on hover or select"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "When a connecting file row in the Zones graph is hovered or selected, draw its cross-zone edges to the target zone box(es) and highlight those boxes, even when the target zone is collapsed. Reuse buildFileToFileMap / fileConnections and the existing edge-path helpers (computeEdgePath, boxEdgeAnchor) in packages/web/src/viewer/views/zones.ts. Acceptance criteria: (1) Hovering/selecting a connecting file draws an edge from the file row to each target zone box. (2) Target zone boxes receive a highlight class while the file is active. (3) Edges/highlights clear on mouse-out / deselect. (4) Works whether or not the target zone is expanded."
---
