---
id: "f9c64896-b533-4502-a73d-94a7de09db1e"
level: "task"
title: "Prioritize and optionally filter connecting files in an expanded zone"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "Within an expanded zone box in the Zones graph, sort file rows so cross-zone-connecting files (those present in fileConnections) render before internal-only files, so bridging files are not hidden by the FILE_ROWS_MAX=15 cap in renderFileContent (packages/web/src/viewer/views/zones.ts). Add a per-zone 'connecting only' toggle that filters the file list to cross-zone files. Ordering/filtering must also apply to nested sub-zone file rows in renderSubZoneContent. Acceptance criteria: (1) When a zone is expanded, files with cross-zone connections render above internal-only files. (2) The '+N more' overflow count reflects the new ordering. (3) A toggle within the expanded zone filters to show only connecting files; toggling back restores the full list. (4) Sorting/filtering applies to nested sub-zone file rows too."
---
