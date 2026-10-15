---
id: "44c0f4e4-3a02-4e95-8393-480e22fbd31f"
level: "task"
title: "Hub files with very high fan-in no longer pull a project into one Louvain community"
status: "pending"
priority: "high"
tags:
  - "sourcevision"
  - "zones"
  - "louvain"
blockedBy:
  - "90a082b6-eec8-442f-909d-868dbb6dff7b"
source: "ndx-capture"
acceptanceCriteria:
  - "A fixture of several module folders that all depend on one shared base class yields more than one zone, with no zone holding most of the files."
  - "Edges into very-high-fan-in hub files carry less weight in the Louvain graph than ordinary edges; the import graph itself is unchanged."
  - "Zone assignments on projects without such hubs are unchanged (existing zone tests pass)."
description: "Retest of #743: hubs (SecurePage.cs 169 in-edges, DataService.cs 143, TranslationTableObjectBase.cs 111, KeyValue.cs 96) collapse the WebForms site into one community (76% of files, top-level cohesion 1 / coupling 0 in every zone, 27 cross-zone edges). When building the Louvain graph, damp the weight of edges into very-high-fan-in files, or split a community over the size limit by top-level module folder (Admin, OrganModule, DRAI, ...). Re-measure after the code-behind scoping task lands."
lastModified: "2026-10-15T02:20:57.399Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
